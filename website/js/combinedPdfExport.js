/**
 * combinedPdfExport.js
 * ---------------------------------------------------------
 * "Export All Departments" - one PDF covering every chart on every
 * department page (Projects, Production, Quality, Painting, Packing &
 * Dispatch), not just this one. Per the person (2026-09-04): "I want
 * an extra export to pdf button in projects tab that will download
 * all charts from all tabs combined." Confirmed via AskUserQuestion:
 * all 5 department pages.
 *
 * There's no server here to pre-render the other 4 pages, so each is
 * loaded in a hidden iframe (same origin - no CORS issue reading its
 * canvases), one at a time (not all 5 at once, to keep memory/Chart.js
 * instances from piling up). This waits for that page's own
 * data-fetch + Chart.js render to finish - every {Dept}App.js adds
 * `is-ready` to <body> once it's actually rendered real data or an
 * empty state (see e.g. painting-app.js -> renderAll(),
 * production-app.js -> showEmptyState()/renderAll()) - then harvests
 * its chart canvases the same way pdfExport.js -> collectSections()
 * does on this page, and appends them into ONE shared jsPDF document
 * with a department header banner between each page's charts.
 *
 * Deliberately charts-only, matching every existing per-page export
 * on this site. Packing & Dispatch's own richer packing-pdfExport.js
 * adds KPI/table sections beyond charts for ITS OWN single-page
 * export - not replicated here, so all 5 departments read the same
 * way in this combined PDF.
 */

const CombinedPdfExport = {

  otherPages: [
    { url: "production.html", title: "Production" },
    { url: "quality.html", title: "Quality Assurance / Control" },
    { url: "painting.html", title: "Painting" },
    { url: "packing-dispatch.html", title: "Packing & Dispatch" },
  ],

  READY_TIMEOUT_MS: 20000,
  POLL_INTERVAL_MS: 250,

  /** Same logic as pdfExport.js -> collectSections(), generalised to read from any document (this page's own, or an iframe's). */
  collectSections(doc) {
    const sections = [];
    doc.querySelectorAll("main > section").forEach((section) => {
      const cards = Array.from(section.querySelectorAll(".chart-card")).filter((card) => card.querySelector("canvas"));
      if (!cards.length) return;
      const groupTitle = section.querySelector(".charts-grid__head h3")?.textContent?.trim() || "";
      const charts = cards.map((card) => ({
        title: card.querySelector(".chart-card__head h3")?.textContent?.trim() || "",
        hint: card.querySelector(".chart-card__hint")?.textContent?.trim() || "",
        canvas: card.querySelector("canvas"),
      }));
      sections.push({ groupTitle, charts });
    });
    return sections;
  },

  /** Polls the IFRAME (not a captured document) so this keeps working
   * even if `onload` fired once for the interim about:blank document
   * before the real navigation landed - re-reading contentDocument
   * every tick means a stale first snapshot can't wedge the poll on a
   * document that will never get "is-ready" (confirmed live: without
   * this, Production/Quality reliably burned the full timeout because
   * the very first onload fired for about:blank, and the captured
   * `doc` reference from that firing never saw the real page load). */
  waitForReady(iframe) {
    return new Promise((resolve) => {
      const start = Date.now();
      const poll = () => {
        const doc = iframe.contentDocument;
        if (doc && doc.body && doc.body.classList.contains("is-ready")) {
          resolve(true);
          return;
        }
        if (Date.now() - start > this.READY_TIMEOUT_MS) {
          resolve(false);
          return;
        }
        setTimeout(poll, this.POLL_INTERVAL_MS);
      };
      poll();
    });
  },

  loadPageSections(url) {
    return new Promise((resolve) => {
      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.top = "0";
      iframe.style.left = "-10000px";
      iframe.style.width = "1400px";
      iframe.style.height = "1000px";
      iframe.style.border = "0";
      iframe.setAttribute("aria-hidden", "true");

      let settled = false;
      const finish = (sections) => {
        if (settled) return;
        settled = true;
        iframe.remove();
        resolve(sections);
      };

      iframe.onload = async () => {
        try {
          const ready = await this.waitForReady(iframe);
          if (!ready) { finish([]); return; }
          // Give Chart.js a moment to finish painting after is-ready flips.
          // A plain timer, not requestAnimationFrame - rAF gets throttled (or
          // never fires at all) for an iframe positioned off-screen like this
          // one, since browsers treat that the same as a backgrounded tab for
          // paint-timing purposes; setTimeout doesn't have that failure mode.
          await new Promise((r) => setTimeout(r, 400));
          const finalDoc = iframe.contentDocument;
          finish(finalDoc ? this.collectSections(finalDoc) : []);
        } catch (error) {
          console.error(`Combined PDF export: couldn't read ${url}`, error);
          finish([]);
        }
      };
      iframe.onerror = () => finish([]);

      document.body.appendChild(iframe);
      iframe.src = url;
    });
  },

  async export() {
    if (typeof SpoolData === "undefined" || !SpoolData.hasData) {
      SpoolApp.showToast("Upload data before exporting charts", true);
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 40;
    const contentWidth = pageWidth - margin * 2;
    const cardPadding = 12;
    const emberRGB = [255, 138, 66];
    const inkRGB = [16, 22, 30];
    const mutedRGB = [110, 122, 138];
    const bannerRGB = [67, 51, 165]; // --ice, DEE's second brand accent (see css/styles.css)

    let y = margin;
    const ensureSpace = (height) => {
      if (y + height > pageHeight - margin) {
        doc.addPage();
        y = margin;
        return true;
      }
      return false;
    };

    // ---- Cover header ---------------------------------------------

    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(...inkRGB);
    doc.text("DEE Piping Systems", margin, y);
    y += 8;
    doc.setDrawColor(...emberRGB);
    doc.setLineWidth(2.5);
    doc.line(margin, y, margin + 60, y);
    y += 20;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(...mutedRGB);
    doc.text(`All Departments — Combined Charts Export · Generated ${new Date().toLocaleString()}`, margin, y);
    y += 30;

    const renderDepartment = (deptTitle, sections) => {
      ensureSpace(44);
      doc.setFillColor(...bannerRGB);
      doc.rect(margin, y, contentWidth, 26, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(255, 255, 255);
      doc.text(deptTitle, margin + 10, y + 17);
      y += 26 + 18;

      if (!sections.length) {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(10);
        doc.setTextColor(...mutedRGB);
        doc.text("No charts available for this department (no data loaded, or it timed out).", margin, y);
        y += 24;
        return;
      }

      for (const section of sections) {
        ensureSpace(28);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.setTextColor(...inkRGB);
        doc.text(section.groupTitle, margin, y);
        y += 8;
        doc.setDrawColor(224, 227, 232);
        doc.setLineWidth(1);
        doc.line(margin, y, pageWidth - margin, y);
        y += 18;

        for (const chart of section.charts) {
          const canvas = chart.canvas;
          if (!canvas.width || !canvas.height) continue; // never rendered

          const imgData = canvas.toDataURL("image/png", 1.0);
          const aspect = canvas.height / canvas.width;
          const imgWidth = contentWidth - cardPadding * 2;
          let imgHeight = imgWidth * aspect;

          const titleHeight = 16;
          const hintHeight = chart.hint ? 14 : 0;
          const maxImgHeight = pageHeight - margin * 2 - titleHeight - hintHeight - cardPadding * 3;
          let drawWidth = imgWidth;
          if (imgHeight > maxImgHeight) {
            imgHeight = maxImgHeight;
            drawWidth = imgHeight / aspect;
          }

          const cardHeight = titleHeight + hintHeight + cardPadding * 3 + imgHeight;
          ensureSpace(Math.min(cardHeight, pageHeight - margin * 2));

          doc.setFillColor(247, 248, 250);
          doc.setDrawColor(226, 230, 236);
          doc.setLineWidth(1);
          doc.roundedRect(margin, y, contentWidth, cardHeight, 6, 6, "FD");

          let textY = y + cardPadding + 9;
          doc.setFont("helvetica", "bold");
          doc.setFontSize(11);
          doc.setTextColor(...inkRGB);
          doc.text(chart.title, margin + cardPadding, textY);
          textY += titleHeight - 4;

          if (chart.hint) {
            doc.setFont("helvetica", "italic");
            doc.setFontSize(9);
            doc.setTextColor(...mutedRGB);
            doc.text(chart.hint, margin + cardPadding, textY);
            textY += hintHeight;
          }

          const imgX = margin + (contentWidth - drawWidth) / 2;
          doc.addImage(imgData, "PNG", imgX, textY + 4, drawWidth, imgHeight);
          y += cardHeight + 16;
        }
      }
    };

    // Projects is this page - read straight from the live DOM, no
    // iframe needed. The other 4 are fetched one at a time below.
    renderDepartment("Projects", this.collectSections(document));

    for (const [i, page] of this.otherPages.entries()) {
      // A short settling gap before spinning up the next iframe -
      // confirmed live that starting one immediately after the last
      // was torn down made its own load noticeably less reliable
      // (the browser was still winding down the previous iframe's
      // background work) than giving it a beat first.
      this.setProgress(`Loading ${page.title}… (${i + 1}/${this.otherPages.length})`);
      await new Promise((r) => setTimeout(r, 250));
      const sections = await this.loadPageSections(page.url);
      renderDepartment(page.title, sections);
    }

    this.setProgress("Finishing up…");

    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...mutedRGB);
      doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - 20, { align: "right" });
      doc.text("DEE Piping Systems — All Departments", margin, pageHeight - 20);
    }

    const stamp = new Date().toISOString().slice(0, 10);
    doc.save(`dee-piping-all-departments-charts-${stamp}.pdf`);
  },

  /** Updates the button's own label while the export runs - NOT the
   * page's shared toast, which auto-hides after ~2.6s (see app.js ->
   * showToast()) and would go silent for most of a run that can take
   * 20-90+ seconds (4 other department pages, each with its own
   * up-to-20-second load budget - see loadPageSections()). Confirmed
   * live this was the likely cause of the export LOOKING dead even
   * while it was still working: nothing on screen changed for the
   * whole run except a subtle button-loading style. The label now
   * names which department is currently loading, so there's always
   * something visibly changing for as long as this is genuinely
   * still running. */
  setProgress(text) {
    const label = document.getElementById("export-all-pdf-btn-label");
    if (label) label.textContent = text;
  },

  init() {
    const btn = document.getElementById("export-all-pdf-btn");
    const label = document.getElementById("export-all-pdf-btn-label");
    if (!btn || !label) return;
    const defaultLabel = label.textContent;

    btn.addEventListener("click", async () => {
      if (btn.classList.contains("is-loading")) return; // already running - ignore a second click
      btn.classList.add("is-loading");
      btn.disabled = true;
      this.setProgress("Starting…");
      try {
        await this.export();
        SpoolApp.showToast("Combined PDF downloaded");
      } catch (error) {
        console.error(error);
        SpoolApp.showToast("Couldn't build the combined PDF - see console for details", true);
      } finally {
        btn.classList.remove("is-loading");
        btn.disabled = false;
        this.setProgress(defaultLabel);
      }
    });
  },
};

document.addEventListener("DOMContentLoaded", () => CombinedPdfExport.init());
