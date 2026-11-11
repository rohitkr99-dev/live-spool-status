/* SIOP Meeting Tracker: where the notes come from and go to.

   LIVE      Firestore (collections mom_cases + mom_updates), shared by everyone
             who is signed in; changes appear on every open page at once.
   EMPTY     Firestore is connected but nothing has been imported yet. The page
             shows the last published tracker, read-only, and offers the import.
   PUBLISHED Firestore is not usable (not created, rules not published, offline).
             The page shows the last published tracker, read-only.

   One record per case (mom_cases, with its latest update copied in so the open
   cases need no extra reads) and one record per update (mom_updates).
   Updates are add-only: the rules allow no edit and no delete. */
(function () {
  "use strict";

  var PUBLISHED_URL = "data/c7d41e98ab.json";
  var IMPORT_URL = "data/mom-import.json";

  var db = null;
  var state = { mode: "loading", note: "", cases: [] };
  var published = null;   // { cases: [...], updates: { caseId: [...] } }
  var listeners = [];

  function emit() { listeners.forEach(function (fn) { fn(); }); }

  // ---- shapes --------------------------------------------------------------

  function fromDoc(d) {
    return {
      case_id: d.caseId, project: d.project, dept: d.dept || "", status: d.status,
      first_raised: d.firstRaised, last_updated: d.lastUpdated, update_count: d.updateCount || 0,
      latest: d.latest || { date: d.lastUpdated, status: d.status, remarks: "" }
    };
  }

  // The published tracker (data/c7d41e98ab.json) and the import file share one format.
  function fromBundle(bundle) {
    var cases = [];
    var updates = {};
    bundle.history.projects.forEach(function (p) {
      p.cases.forEach(function (c) {
        cases.push({
          case_id: c.case_id, project: p.project, dept: c.dept || "", status: c.status,
          first_raised: c.first_raised, last_updated: c.last_updated, update_count: c.updates.length,
          latest: c.updates[c.updates.length - 1]
        });
        updates[c.case_id] = c.updates;
      });
    });
    return { cases: cases, updates: updates };
  }

  function latestOf(u) {
    var latest = { date: u.date, status: u.status, remarks: u.remarks || "" };
    if (u.items && u.items.length) latest.items = u.items;
    return latest;
  }

  function updateDoc(base, u, user, stamp) {
    var doc = {
      caseId: base.case_id, project: base.project, dept: base.dept || "",
      date: u.date, status: u.status, remarks: u.remarks || "",
      createdByUid: user.uid, createdByEmail: user.email || "", createdAt: stamp
    };
    if (u.items && u.items.length) doc.items = u.items;
    return doc;
  }

  // ---- loading -------------------------------------------------------------

  function loadPublished() {
    if (published) return Promise.resolve(published);
    return fetch(PUBLISHED_URL, { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (bundle) { published = fromBundle(bundle); return published; });
  }

  function useFallback(mode, note) {
    return loadPublished().then(function (p) {
      state.mode = mode; state.note = note; state.cases = p.cases;
    }, function () {
      state.mode = "published"; state.note = note || "The published notes could not be loaded."; state.cases = [];
    }).then(emit);
  }

  function describe(error) {
    if (error && error.code === "permission-denied") return "The database rules are not published yet.";
    if (error && (error.code === "failed-precondition" || error.code === "not-found")) return "The database has not been created yet.";
    return "The database could not be reached" + (error && error.code ? " (" + error.code + ")" : "") + ".";
  }

  function startLive() {
    db.collection("mom_cases").onSnapshot(function (snap) {
      var cases = [];
      snap.forEach(function (doc) { cases.push(fromDoc(doc.data())); });
      if (!cases.length) { useFallback("empty", ""); return; }
      state.mode = "live"; state.note = ""; state.cases = cases;
      emit();
    }, function (error) {
      useFallback("published", describe(error));
    });
  }

  function connect() {
    if (!(window.firebase && firebase.auth && firebase.firestore)) {
      return useFallback("published", "The live database is not loaded on this page.");
    }
    db = firebase.firestore();
    var started = false;
    // Wait for the sign-in to be restored, or the first request goes out signed out.
    firebase.auth().onAuthStateChanged(function (user) {
      if (user && !started) { started = true; startLive(); }
    });
  }

  // ---- history of the cases of one project ---------------------------------

  function loadUpdates(project) {
    if (state.mode !== "live") {
      return loadPublished().then(function (p) { return p.updates; });
    }
    return db.collection("mom_updates").where("project", "==", project).get().then(function (snap) {
      var byCase = {};
      snap.forEach(function (doc) {
        var d = doc.data();
        var update = {
          date: d.date, status: d.status, remarks: d.remarks || "", items: d.items,
          by: d.createdByEmail || "", ts: d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : 0
        };
        (byCase[d.caseId] = byCase[d.caseId] || []).push(update);
      });
      Object.keys(byCase).forEach(function (id) {
        byCase[id].sort(function (a, b) { return a.date.localeCompare(b.date) || a.ts - b.ts; });
      });
      return byCase;
    });
  }

  // ---- saving --------------------------------------------------------------

  function nextCaseId() {
    var max = 0;
    state.cases.forEach(function (c) { max = Math.max(max, parseInt(String(c.case_id).slice(2), 10) || 0); });
    return max + 1;
  }

  function formatId(n) { return "C-" + String(n).padStart(4, "0"); }

  // entry: { case_id (omit for a new case), project, dept, date, status, remarks, items }
  function saveUpdate(entry) {
    if (state.mode !== "live") return Promise.reject(new Error("The live database is not connected."));
    var user = firebase.auth().currentUser;
    if (!user) return Promise.reject(new Error("You are signed out. Sign in again."));
    var stamp = firebase.firestore.FieldValue.serverTimestamp();
    var isNew = !entry.case_id;
    var number = isNew ? nextCaseId() : 0;
    var tries = 0;

    function attempt() {
      var caseId = isNew ? formatId(number) : entry.case_id;
      var caseRef = db.collection("mom_cases").doc(caseId);
      var updateRef = db.collection("mom_updates").doc();
      return db.runTransaction(function (tx) {
        return tx.get(caseRef).then(function (snap) {
          if (isNew && snap.exists) { var clash = new Error("exists"); clash.code = "case-exists"; throw clash; }
          if (!isNew && !snap.exists) throw new Error("That case no longer exists.");
          var before = snap.exists ? snap.data() : null;
          var base = before ? { case_id: caseId, project: before.project, dept: before.dept || "" }
                            : { case_id: caseId, project: entry.project, dept: entry.dept };
          tx.set(caseRef, {
            caseId: caseId, project: base.project, dept: base.dept, status: entry.status,
            firstRaised: before ? before.firstRaised : entry.date, lastUpdated: entry.date,
            updateCount: (before ? before.updateCount || 0 : 0) + 1, latest: latestOf(entry)
          });
          tx.set(updateRef, updateDoc(base, entry, user, stamp));
        });
      }).then(function () { return caseId; }, function (error) {
        // Someone else took that number a moment ago: try the next one.
        if (error && error.code === "case-exists" && ++tries < 5) { number++; return attempt(); }
        throw error;
      });
    }
    return attempt();
  }

  // One-time: copy the existing tracker history into the database.
  function importHistory() {
    if (state.mode !== "empty") return Promise.reject(new Error("The database already has notes."));
    var user = firebase.auth().currentUser;
    if (!user) return Promise.reject(new Error("You are signed out. Sign in again."));
    return fetch(IMPORT_URL, { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("The import file could not be loaded (HTTP " + r.status + ")."); return r.json(); })
      .then(function (bundle) {
        var data = fromBundle(bundle);
        var stamp = firebase.firestore.FieldValue.serverTimestamp();
        var batch = db.batch();
        var updates = 0;
        data.cases.forEach(function (c) {
          var list = data.updates[c.case_id];
          var last = list[list.length - 1];
          batch.set(db.collection("mom_cases").doc(c.case_id), {
            caseId: c.case_id, project: c.project, dept: c.dept, status: last.status,
            firstRaised: list[0].date, lastUpdated: last.date, updateCount: list.length, latest: latestOf(last)
          });
          list.forEach(function (u, i) {
            // Fixed ids, so a second import can never create duplicates.
            batch.set(db.collection("mom_updates").doc(c.case_id + "_" + u.date + "_" + i), updateDoc(c, u, user, stamp));
            updates++;
          });
        });
        return batch.commit().then(function () { return { cases: data.cases.length, updates: updates }; });
      });
  }

  window.MomData = {
    connect: connect,
    mode: function () { return state.mode; },
    note: function () { return state.note; },
    cases: function () { return state.cases; },
    onChange: function (fn) { listeners.push(fn); },
    loadUpdates: loadUpdates,
    saveUpdate: saveUpdate,
    importHistory: importHistory,
    user: function () { return window.firebase && firebase.auth && firebase.auth().currentUser; }
  };
})();
