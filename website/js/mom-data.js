/* SIOP Meeting Tracker: where the notes come from and go to.

   Each project has one running record. Every meeting adds a dated note to its
   project; there are no case numbers and no Open / Closed status. A project that
   was not discussed at the latest meeting is simply shown with an older date.

   LIVE      Firestore (collections mom_projects + mom_notes), shared by everyone
             who is signed in; changes appear on every open page at once.
   EMPTY     Firestore is connected but nothing has been imported yet. The page
             shows the last published tracker, read-only, and offers the import.
   PUBLISHED Firestore is not usable (not created, rules not published, offline).
             The page shows the last published tracker, read-only.

   One record per project (mom_projects, with its latest note copied in so the
   list needs no extra reads) and one record per note (mom_notes).
   Notes are add-only: the rules allow no edit and no delete. */
(function () {
  "use strict";

  var PUBLISHED_URL = "data/c7d41e98ab.json";
  var IMPORT_URL = "data/mom-import.json";
  var PROJECTS = "mom_projects";
  var NOTES = "mom_notes";

  var db = null;
  var state = { mode: "loading", note: "", projects: [] };
  var published = null;   // { projects: [...], notes: { projectId: [...] } }
  var listeners = [];

  function emit() { listeners.forEach(function (fn) { fn(); }); }

  // ---- names ---------------------------------------------------------------

  function projectId(project) {
    return String(project || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  // ---- shapes --------------------------------------------------------------

  function fromDoc(d) {
    return {
      project_id: d.projectId, project: d.project, first_date: d.firstDate, last_updated: d.lastUpdated,
      update_count: d.updateCount || 0, latest: d.latest || { date: d.lastUpdated, remarks: "" }
    };
  }

  // The published tracker (data/c7d41e98ab.json) and the import file share one
  // format, built around numbered cases with a status and a department. Here
  // every case of a project is merged into the project's one record: the status
  // is dropped, the department stays as a small label on each note.
  function fromBundle(bundle) {
    var byId = {};
    var order = [];
    bundle.history.projects.forEach(function (p) {
      var id = projectId(p.project);
      if (!byId[id]) { byId[id] = { project: p.project, notes: [] }; order.push(id); }
      p.cases.forEach(function (c) {
        c.updates.forEach(function (u) {
          var note = { date: u.date, remarks: u.remarks || "" };
          if (u.items && u.items.length) note.items = u.items;
          if (c.dept) note.dept = c.dept;
          byId[id].notes.push(note);
        });
      });
    });
    var projects = [];
    var notes = {};
    order.forEach(function (id) {
      var list = byId[id].notes.map(function (n, i) { return { n: n, i: i }; })
        .sort(function (a, b) { return a.n.date.localeCompare(b.n.date) || a.i - b.i; })
        .map(function (x) { return x.n; });
      var last = list[list.length - 1];
      projects.push({
        project_id: id, project: byId[id].project, first_date: list[0].date, last_updated: last.date,
        update_count: list.length, latest: last
      });
      notes[id] = list;
    });
    return { projects: projects, notes: notes };
  }

  function latestOf(n) {
    var latest = { date: n.date, remarks: n.remarks || "" };
    if (n.items && n.items.length) latest.items = n.items;
    if (n.dept) latest.dept = n.dept;
    return latest;
  }

  function noteDoc(project, n, user, stamp) {
    var doc = {
      projectId: projectId(project), project: project, date: n.date, remarks: n.remarks || "",
      createdByUid: user.uid, createdByEmail: user.email || "", createdAt: stamp
    };
    if (n.items && n.items.length) doc.items = n.items;
    if (n.dept) doc.dept = n.dept;
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
      state.mode = mode; state.note = note; state.projects = p.projects;
    }, function () {
      state.mode = "published"; state.note = note || "The published notes could not be loaded."; state.projects = [];
    }).then(emit);
  }

  function describe(error) {
    if (error && error.code === "permission-denied") return "The database rules are not published yet.";
    if (error && (error.code === "failed-precondition" || error.code === "not-found")) return "The database has not been created yet.";
    return "The database could not be reached" + (error && error.code ? " (" + error.code + ")" : "") + ".";
  }

  function startLive() {
    db.collection(PROJECTS).onSnapshot(function (snap) {
      var projects = [];
      snap.forEach(function (doc) { projects.push(fromDoc(doc.data())); });
      if (!projects.length) { useFallback("empty", ""); return; }
      state.mode = "live"; state.note = ""; state.projects = projects;
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

  // ---- the notes of one project, oldest first ------------------------------

  function loadNotes(project) {
    if (state.mode !== "live") {
      return loadPublished().then(function (p) { return p.notes[projectId(project)] || []; });
    }
    return db.collection(NOTES).where("project", "==", project).get().then(function (snap) {
      var list = [];
      snap.forEach(function (doc) {
        var d = doc.data();
        list.push({
          date: d.date, remarks: d.remarks || "", items: d.items, dept: d.dept || "",
          by: d.createdByEmail || "", ts: d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : 0
        });
      });
      return list.sort(function (a, b) { return a.date.localeCompare(b.date) || a.ts - b.ts; });
    });
  }

  // ---- saving --------------------------------------------------------------

  // entry: { project, date, remarks, items }
  function saveNote(entry) {
    if (state.mode !== "live") return Promise.reject(new Error("The live database is not connected."));
    var user = firebase.auth().currentUser;
    if (!user) return Promise.reject(new Error("You are signed out. Sign in again."));
    var stamp = firebase.firestore.FieldValue.serverTimestamp();
    var id = projectId(entry.project);
    var projectRef = db.collection(PROJECTS).doc(id);
    var noteRef = db.collection(NOTES).doc();
    return db.runTransaction(function (tx) {
      return tx.get(projectRef).then(function (snap) {
        var before = snap.exists ? snap.data() : null;
        // A note typed for an earlier date never replaces a newer "latest".
        var newest = !before || entry.date >= before.lastUpdated;
        tx.set(projectRef, {
          projectId: id, project: entry.project,
          firstDate: before ? before.firstDate : entry.date,
          lastUpdated: newest ? entry.date : before.lastUpdated,
          updateCount: (before ? before.updateCount || 0 : 0) + 1,
          latest: newest ? latestOf(entry) : before.latest
        });
        tx.set(noteRef, noteDoc(entry.project, entry, user, stamp));
      });
    }).then(function () { return id; });
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
        var notes = 0;
        data.projects.forEach(function (p) {
          var list = data.notes[p.project_id];
          var last = list[list.length - 1];
          batch.set(db.collection(PROJECTS).doc(p.project_id), {
            projectId: p.project_id, project: p.project, firstDate: list[0].date,
            lastUpdated: last.date, updateCount: list.length, latest: latestOf(last)
          });
          list.forEach(function (n, i) {
            // Fixed ids, so a second import can never create duplicates.
            batch.set(db.collection(NOTES).doc(p.project_id + "_" + n.date + "_" + i), noteDoc(p.project, n, user, stamp));
            notes++;
          });
        });
        return batch.commit().then(function () { return { projects: data.projects.length, notes: notes }; });
      });
  }

  window.MomData = {
    connect: connect,
    mode: function () { return state.mode; },
    note: function () { return state.note; },
    projects: function () { return state.projects; },
    onChange: function (fn) { listeners.push(fn); },
    loadNotes: loadNotes,
    saveNote: saveNote,
    importHistory: importHistory,
    projectId: projectId,
    user: function () { return window.firebase && firebase.auth && firebase.auth().currentUser; }
  };
})();
