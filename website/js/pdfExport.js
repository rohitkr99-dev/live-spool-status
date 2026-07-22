/**
 * pdfExport.js
 * ---------------------------------------------------------
 * "Export Charts to PDF" - bundles every chart currently on screen
 * (Overview, Stage Activity, Stage Throughput, Stage Ageing Summary)
 * into a single downloadable PDF. Deliberately does NOT include the
 * spool-wise tables - charts only.
 *
 * Each chart is already a live Chart.js <canvas>, and a canvas can
 * export its own current pixels directly via toDataURL() - so this
 * doesn't need to screenshot the page (no html2canvas dependency),
 * it just reads the same pixels the browser is already showing.
 */

const SpoolPdfExport = {

  /** One entry per <section> on the page that holds chart cards -
   * anything without a ".chart-card canvas" (KPI strip, fabline,
   * the spool tables) is skipped automatically. */
  collectSections() {

    const sections = [];

    document.querySelectorAll("main > section").forEach((section) => {

      const cards = Array.from(
        section.querySelectorAll(".chart-card")
      ).filter((card) => card.querySelector("canvas"));

      if (!cards.length) return;

      const groupTitle =
        section.querySelector(".charts-grid__head h3")?.textContent?.trim() ||
        "";

      const note = groupTitle === "Stage Ageing Summary"
        ? this.stageAgeingProjectNote()
        : "";

      const charts = cards.map((card) => ({
        title: card.querySelector(".chart-card__head h3")?.textContent?.trim() || "",
        hint: card.querySelector(".chart-card__hint")?.textContent?.trim() || "",
        canvas: card.querySelector("canvas"),
      }));

      sections.push({ groupTitle, note, charts });
    });

    return sections;
  },

  /** Extra context worth noting on the Stage Ageing Summary charts
   * specifically, since they can be filtered to a single project. */
  stageAgeingProjectNote() {
    const select = document.getElementById("stage-ageing-project");
    if (!select || select.value === "__all__") return "";
    const label = select.options[select.selectedIndex]?.text || select.value;
    return `Project: ${label}`;
  },

  async export() {

    if (typeof SpoolData === "undefined" || !SpoolData.hasData) {
      SpoolApp.showToast("Upload data before exporting charts", true);
      return;
    }

    const sections = this.collectSections();

    if (!sections.length) {
      SpoolApp.showToast("No charts to export yet", true);
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
    doc.setFontSize(18);
    doc.setTextColor(...inkRGB);
    doc.text("Spool Status", margin, y);
    y += 6;
    doc.setDrawColor(...emberRGB);
    doc.setLineWidth(2.5);
    doc.line(margin, y, margin + 46, y);
    y += 18;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...mutedRGB);
    const generatedAt = document.getElementById("last-updated")?.textContent || "";
    doc.text(
      `Charts export \u00b7 Data as of ${generatedAt} \u00b7 Generated ${new Date().toLocaleString()}`,
      margin,
      y
    );
    y += 26;

    for (const section of sections) {

      // Section heading
      ensureSpace(30);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(...inkRGB);
      doc.text(
        section.note ? `${section.groupTitle}  \u2014  ${section.note}` : section.groupTitle,
        margin,
        y
      );
      y += 8;
      doc.setDrawColor(224, 227, 232);
      doc.setLineWidth(1);
      doc.line(margin, y, pageWidth - margin, y);
      y += 20;

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

        // Card frame - a light "printed panel" behind each dark
        // chart image (chart canvases carry their own opaque dark
        // backing fill - see js/chartTheme.js).
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

    // ---- Page numbers ----------------------------------------------

    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...mutedRGB);
      doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - 20, { align: "right" });
      doc.text("Spool Status \u2014 Live Production Intelligence", margin, pageHeight - 20);
    }

    const stamp = new Date().toISOString().slice(0, 10);
    doc.save(`spool-status-charts-${stamp}.pdf`);
  },

  init() {
    const btn = document.getElementById("export-pdf-btn");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      btn.classList.add("is-loading");
      try {
        await this.export();
      } catch (error) {
        console.error(error);
        SpoolApp.showToast("Couldn't build the PDF - see console for details", true);
      } finally {
        btn.classList.remove("is-loading");
      }
    });
  },
};

document.addEventListener("DOMContentLoaded", () => SpoolPdfExport.init());
