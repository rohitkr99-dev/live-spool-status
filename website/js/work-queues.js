/*
 * Work queues are a read-only view of the published dashboard bundle.
 * Shared assignments and handoffs live in Firestore and never write
 * back to fabrication source data or alter business-rule calculations.
 */
const WorkQueues = {
  rows: [],
  assignments: new Map(),
  handoffs: [],
  user: null,
  firestoreReady: false,
  assignmentsReady: false,
  handoffsReady: false,
  storeErrors: false,
  activeView: "team",
  activeDepartment: "all",
  timer: null,

  init() {
    document.getElementById("footer-year").textContent = new Date().getFullYear();
    document.querySelectorAll(".wq-views button").forEach(button => button.addEventListener("click", () => {
      this.activeView = button.dataset.view;
      document.querySelectorAll(".wq-views button").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
      this.render();
    }));
    document.getElementById("search").addEventListener("input", () => this.render());
    document.getElementById("department").addEventListener("change", event => { this.activeDepartment = event.target.value; this.render(); });
    document.getElementById("age-filter").addEventListener("change", () => this.render());
    document.getElementById("handoff-form").addEventListener("submit", event => this.submitHandoff(event));

    firebase.auth().onAuthStateChanged(user => {
      if (!user || this.user) return;
      this.user = user;
      this.connectSharedStore();
    });
    this.loadSpoolData();
  },

  async loadSpoolData() {
    const status = document.getElementById("data-status");
    try {
      const result = await SpoolData.fetchPublished();
      const store = result.store;
      this.rows = store.masterSpools.filter(row => row.Completed !== true && String(row["Current Stage"] || "") !== "Completed");
      document.getElementById("data-updated").textContent = `Published ${this.formatDate(result.generatedAt)} · ${this.rows.length.toLocaleString()} active spools`;
      status.dataset.state = "ok";
      status.textContent = `Live published spool data loaded · ${store.masterSpools.length.toLocaleString()} records · Generated ${this.formatDate(result.generatedAt)}`;
      this.render();
    } catch (error) {
      console.error("Could not load published spool data", error);
      status.dataset.state = "error";
      status.textContent = `The published spool data could not be loaded. ${error.message}`;
      document.getElementById("queue-empty").hidden = false;
      document.getElementById("queue-empty").textContent = "Live spool data is unavailable; refresh after the published bundle is reachable.";
    }
  },

  connectSharedStore() {
    try {
      const db = firebase.firestore();
      db.collection("work_queue_assignments").onSnapshot(snapshot => {
        this.assignments = new Map(snapshot.docs.map(doc => [doc.id, doc.data()]));
        this.assignmentsReady = true;
        this.updateSharedStatus();
        this.render();
      }, error => this.sharedStoreError(error));
      db.collection("work_handoffs").where("status", "==", "open").onSnapshot(snapshot => {
        this.handoffs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        this.handoffs.sort((a, b) => this.timestampMs(b.createdAt) - this.timestampMs(a.createdAt));
        this.handoffsReady = true;
        this.updateSharedStatus();
        this.render();
      }, error => this.sharedStoreError(error));
    } catch (error) {
      this.sharedStoreError(error);
    }
  },

  sharedStoreError(error) {
    console.error("Shared work queue store unavailable", error);
    this.storeErrors = true;
    this.firestoreReady = false;
    const status = document.getElementById("data-status");
    status.dataset.state = "error";
    status.textContent = "Live spool records are shown, but shared claims and handoffs are unavailable. Check that Cloud Firestore is enabled and its work-queue rules are deployed.";
    this.render();
  },

  updateSharedStatus() {
    this.firestoreReady = this.assignmentsReady && this.handoffsReady && !this.storeErrors;
    if (!this.firestoreReady) return;
    const status = document.getElementById("data-status");
    status.dataset.state = "ok";
    if (this.rows.length) status.textContent = `Live published spool data and shared team actions are connected · ${this.rows.length.toLocaleString()} active spools`;
  },

  departmentForStage(stage) {
    if (["Production Order Not Released", "Spools Planned in Next Week"].includes(stage)) return "Projects";
    if (["Fit-Up", "Partial Fit-Up/Welding", "Welding"].includes(stage)) return "Production";
    if (stage === "PDQC") return "Quality";
    if (["Ready for Painting", "Under Painting"].includes(stage)) return "Painting";
    if (["Packing", "Dispatch"].includes(stage)) return "Packing & Dispatch";
    return "Projects";
  },

  spoolKey(row) {
    return String(row["Composite Key"] || [row["Project Code"], row["Drawing No"], row["Spool No"]].join(" | "));
  },

  docId(key) {
    return encodeURIComponent(key).replaceAll("%", "_");
  },

  escape(value) {
    return String(value ?? "—").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" }[char]));
  },

  stageAge(row) {
    if (row["Stage Age"] === null || row["Stage Age"] === undefined || row["Stage Age"] === "") return null;
    const value = Number(row["Stage Age"]);
    return Number.isFinite(value) ? value : null;
  },

  ageClass(age) {
    const thresholds = SPOOL_STATUS_CONFIG.ageThresholds;
    if (age === null) return "";
    if (age >= thresholds.criticalDays) return "wq-age--critical";
    if (age >= thresholds.warnDays) return "wq-age--warn";
    return "";
  },

  matches(row) {
    const stage = String(row["Current Stage"] || "");
    const key = this.spoolKey(row);
    const assignment = this.assignments.get(this.docId(key));
    const age = this.stageAge(row);
    const search = document.getElementById("search").value.trim().toLowerCase();
    const ageFilter = document.getElementById("age-filter").value;
    const dept = this.departmentForStage(stage);
    const haystack = [key, row["Project Code"], row["Project Name"], row["Drawing No"], row["Spool No"], stage, row["Next Stage"], row["Status Message"], row.Material].join(" ").toLowerCase();
    if (this.activeDepartment !== "all" && dept !== this.activeDepartment) return false;
    if (this.activeView === "mine" && (!assignment || assignment.ownerUid !== this.user?.uid)) return false;
    if (this.activeView === "handoffs" && !this.handoffs.some(handoff => handoff.spoolKey === key && handoff.status === "open")) return false;
    if (ageFilter === "warn" && (age === null || age < SPOOL_STATUS_CONFIG.ageThresholds.warnDays)) return false;
    if (ageFilter === "critical" && (age === null || age < SPOOL_STATUS_CONFIG.ageThresholds.criticalDays)) return false;
    return !search || haystack.includes(search);
  },

  render() {
    const thresholds = SPOOL_STATUS_CONFIG.ageThresholds;
    const critical = this.rows.filter(row => (this.stageAge(row) ?? -1) >= thresholds.criticalDays).length;
    const warn = this.rows.filter(row => (this.stageAge(row) ?? -1) >= thresholds.warnDays).length;
    document.getElementById("kpi-open").textContent = this.rows.length.toLocaleString();
    document.getElementById("kpi-warn").textContent = warn.toLocaleString();
    document.getElementById("kpi-critical").textContent = critical.toLocaleString();
    document.getElementById("kpi-handoffs").textContent = this.handoffs.filter(item => item.status === "open").length.toLocaleString();
    document.getElementById("handoff-count").textContent = `${this.handoffs.filter(item => item.status === "open").length} open`;

    const list = this.rows.filter(row => this.matches(row));
    list.sort((a, b) => (this.stageAge(b) ?? -1) - (this.stageAge(a) ?? -1));
    document.getElementById("queue-count").textContent = `${list.length.toLocaleString()} spools`;
    const body = document.getElementById("queue-body");
    body.innerHTML = list.slice(0, 500).map(row => {
      const key = this.spoolKey(row);
      const id = this.docId(key);
      const assignment = this.assignments.get(id);
      const age = this.stageAge(row);
      const isMine = assignment?.ownerUid === this.user?.uid;
      const claimed = Boolean(assignment);
      const claimText = !this.firestoreReady ? "Unavailable" : claimed ? (isMine ? "Release claim" : `Claimed · ${assignment.ownerEmail || "team member"}`) : "Claim";
      const claimAction = isMine ? "release" : "claim";
      return `<tr>
        <td data-label="Spool / drawing" data-col="spool"><div class="wq-spool"><strong>${this.escape(row["Spool No"])}</strong><span>${this.escape(row["Project Code"])} · ${this.escape(row["Drawing No"])}</span></div></td>
        <td data-label="Current stage"><span class="wq-stage">${this.escape(row["Current Stage"])}</span></td>
        <td data-label="Next stage">${this.escape(row["Next Stage"])}</td>
        <td data-label="Stage age" class="wq-age ${this.ageClass(age)}">${age === null ? "—" : `${age} d`}</td>
        <td data-label="Status message" data-col="status" class="wq-status">${this.escape(row["Status Message"])}</td>
        <td data-label="Claim" data-col="claim"><button class="wq-button ${!claimed ? "wq-button--primary" : ""}" data-claim="${this.escape(id)}" data-key="${this.escape(key)}" data-action="${claimAction}" ${(!this.firestoreReady || (claimed && !isMine)) ? "disabled" : ""}>${this.escape(claimText)}</button></td>
        <td data-label="Handoff" data-col="handoff"><button class="wq-button" data-handoff="${this.escape(id)}" ${!this.firestoreReady ? "disabled" : ""}>Send</button></td>
      </tr>`;
    }).join("");
    document.getElementById("queue-empty").hidden = list.length > 0;
    if (list.length > 500) document.getElementById("queue-foot").textContent = `Showing the first 500 matching spools, ordered by existing stage age. ${list.length.toLocaleString()} match; narrow by department, stage age, or search. No queue action changes spool status or fabrication data.`;
    else document.getElementById("queue-foot").textContent = "Values are read from the published dashboard bundle. No queue action changes spool status or fabrication data.";
    body.querySelectorAll("[data-claim]").forEach(button => button.addEventListener("click", () => this.claim(button.dataset.key, button.dataset.action)));
    body.querySelectorAll("[data-handoff]").forEach(button => button.addEventListener("click", () => this.openHandoff(button.dataset.key)));
    this.renderHandoffs();
  },

  async claim(key, action) {
    if (!this.firestoreReady || !this.user) return;
    const reference = firebase.firestore().collection("work_queue_assignments").doc(this.docId(key));
    try {
      await firebase.firestore().runTransaction(async transaction => {
        const snapshot = await transaction.get(reference);
        if (action === "release") {
          if (!snapshot.exists || snapshot.data().ownerUid !== this.user.uid) throw new Error("Only the person who claimed this spool can release it.");
          transaction.delete(reference);
          return;
        }
        if (snapshot.exists) throw new Error("This spool has already been claimed by a teammate.");
        transaction.set(reference, { spoolKey: key, ownerUid: this.user.uid, ownerEmail: this.user.email || "", claimedAt: firebase.firestore.FieldValue.serverTimestamp() });
      });
      this.toast(action === "release" ? "Claim released for the team." : "Spool added to your shared queue.");
    } catch (error) { this.toast(error.message || "Could not update the claim. Check the shared-store setup."); }
  },

  openHandoff(key) {
    const row = this.rows.find(item => this.spoolKey(item) === key);
    if (!row) return;
    const dialog = document.getElementById("handoff-dialog");
    document.getElementById("handoff-spool").textContent = `${row["Project Code"]} · ${row["Drawing No"]} · ${row["Spool No"]} · ${row["Current Stage"]}`;
    document.getElementById("handoff-target").value = "";
    dialog.dataset.spoolKey = key;
    document.getElementById("handoff-note").value = "";
    dialog.showModal();
  },

  async submitHandoff(event) {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    if (!this.firestoreReady || !this.user) { this.toast("Shared handoffs are unavailable until Firestore is connected."); return; }
    const key = document.getElementById("handoff-dialog").dataset.spoolKey;
    const row = this.rows.find(item => this.spoolKey(item) === key);
    const button = document.getElementById("send-handoff");
    button.disabled = true;
    try {
      await firebase.firestore().collection("work_handoffs").add({
        spoolKey: key,
        projectCode: row["Project Code"] || "",
        projectName: row["Project Name"] || "",
        drawingNo: row["Drawing No"] || "",
        spoolNo: row["Spool No"] || "",
        currentStage: row["Current Stage"] || "",
        nextStage: row["Next Stage"] || "",
        statusMessage: row["Status Message"] || "",
        fromDepartment: this.departmentForStage(String(row["Current Stage"] || "")),
        toDepartment: document.getElementById("handoff-target").value,
        note: document.getElementById("handoff-note").value.trim(),
        status: "open",
        createdByUid: this.user.uid,
        createdByEmail: this.user.email || "",
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      document.getElementById("handoff-dialog").close();
      this.toast("Handoff sent to the shared team queue.");
    } catch (error) { this.toast(error.message || "Could not send the handoff. Check the shared-store setup."); }
    finally { button.disabled = false; }
  },

  renderHandoffs() {
    const open = this.handoffs.filter(item => item.status === "open");
    const list = document.getElementById("handoff-list");
    if (!open.length) { list.innerHTML = '<p class="wq-muted">No open handoffs.</p>'; return; }
    list.innerHTML = open.slice(0, 60).map(item => `<article class="wq-handoff">
      <div class="wq-handoff__route"><span>${this.escape(item.fromDepartment)} → ${this.escape(item.toDepartment)}</span><span>${this.escape(this.timeAgo(item.createdAt))}</span></div>
      <h3>${this.escape(item.projectCode)} · ${this.escape(item.drawingNo)} · ${this.escape(item.spoolNo)}</h3>
      <p>${this.escape(item.currentStage)} → ${this.escape(item.nextStage)}</p>
      <p>${this.escape(item.note)}</p><p>Sent by ${this.escape(item.createdByEmail || "team member")}</p>
      <div class="wq-handoff__actions"><button class="wq-button wq-button--primary" data-respond="${this.escape(item.id)}" data-response="acknowledged">Acknowledge</button><button class="wq-button" data-respond="${this.escape(item.id)}" data-response="clarification_requested">Request detail</button></div>
    </article>`).join("");
    list.querySelectorAll("[data-respond]").forEach(button => button.addEventListener("click", () => this.respond(button.dataset.respond, button.dataset.response)));
  },

  async respond(id, status) {
    if (!this.firestoreReady || !this.user) return;
    let responseNote = "";
    if (status === "clarification_requested") {
      responseNote = window.prompt("What detail does your team need before accepting this handoff?") || "";
      if (!responseNote.trim()) return;
    }
    try {
      await firebase.firestore().collection("work_handoffs").doc(id).update({ status, responseNote: responseNote.trim(), respondedByUid: this.user.uid, respondedByEmail: this.user.email || "", respondedAt: firebase.firestore.FieldValue.serverTimestamp() });
      this.toast(status === "acknowledged" ? "Handoff acknowledged." : "Detail request recorded in the handoff.");
    } catch (error) { this.toast(error.message || "Could not record the response."); }
  },

  formatDate(value) {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.valueOf()) ? new Intl.DateTimeFormat(undefined, { dateStyle:"medium", timeStyle:"short" }).format(date) : "timestamp unavailable";
  },

  timestampMs(value) {
    if (value?.toDate) return value.toDate().getTime();
    if (value instanceof Date) return value.getTime();
    const parsed = Date.parse(value || "");
    return Number.isFinite(parsed) ? parsed : 0;
  },

  timeAgo(value) {
    const time = this.timestampMs(value);
    if (!time) return "just now";
    const hours = Math.max(0, Math.floor((Date.now() - time) / 3600000));
    return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
  },

  toast(message) {
    const element = document.getElementById("toast");
    element.textContent = message;
    element.classList.add("is-visible");
    clearTimeout(this.timer);
    this.timer = setTimeout(() => element.classList.remove("is-visible"), 3200);
  },
};

document.addEventListener("DOMContentLoaded", () => WorkQueues.init());

