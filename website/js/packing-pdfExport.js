/**
 * packing-pdfExport.js
 * ---------------------------------------------------------
 * "Download PDF" - bundles the KPI summary, every chart currently on
 * screen, and the compact Project Summary table into one downloadable
 * PDF. Deliberately does NOT include the Shipments/Boxes/All Spools
 * tables (thousands of rows would make an unusable PDF) - those have
 * their own "Export to Excel" buttons for that. Same technique as
 * website/js/pdfExport.js on the Projects dashboard: each chart is
 * already a live Chart.js <canvas>, so it exports its own current
 * pixels via toDataURL() - no html2canvas / page-screenshot needed.
 * Every number in this PDF is read from what's already rendered on
 * the page (DOM text, canvas pixels) - nothing is recalculated here.
 */

const PackingPdfExport = {

  collectSections() {
    const sections = [];

    document.querySelectorAll("main > section").forEach((section) => {
      const cards = Array.from(section.querySelectorAll(".chart-card"))
        .filter((card) => card.querySelector("canvas"));
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

  collectKpis() {
    return Array.from(document.querySelectorAll("#kpi-strip .kpi-card")).map((card) => ({
      label: card.querySelector(".kpi-card__label")?.textContent?.trim() || "",
      value: card.querySelector(".kpi-card__value")?.textContent?.trim() || "—",
      sub: card.querySelector(".kpi-card__sub")?.textContent?.trim() || "",
    }));
  },

  async export() {
    if (typeof PackingData === "undefined" || !PackingData.hasData) {
      PackingApp.showToast("Load data before downloading the PDF", true);
      return;
    }

    const kpis = this.collectKpis();
    const sections = this.collectSections();
    const projects = PackingData.store.projectSummary || [];

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 40;
    const contentWidth = pageWidth - margin * 2;
    const cardPadding = 12;
    const accentRGB = [67, 51, 165];
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
    doc.text("Packing & Dispatch", margin, y);
    y += 6;
    doc.setDrawColor(...accentRGB);
    doc.setLineWidth(2.5);
    doc.line(margin, y, margin + 46, y);
    y += 18;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...mutedRGB);
    const generatedAt = document.getElementById("last-updated")?.textContent || "";
    doc.text(
      `Data as of ${generatedAt} \u00b7 Generated ${new Date().toLocaleString()}`,
      margin, y,
    );
    y += 26;

    // ---- KPI summary -------------------------------------------------
    if (kpis.length) {
      ensureSpace(30);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(...inkRGB);
      doc.text("Key Metrics", margin, y);
      y += 8;
      doc.setDrawColor(224, 227, 232);
      doc.setLineWidth(1);
      doc.line(margin, y, pageWidth - margin, y);
      y += 18;

      const colCount = 3;
      const colWidth = contentWidth / colCount;
      const rowHeight = 44;
      const rows = Math.ceil(kpis.length / colCount);
      ensureSpace(rows * rowHeight);

      kpis.forEach((kpi, i) => {
        const col = i % colCount;
        const row = Math.floor(i / colCount);
        const x = margin + col * colWidth;
        const cellY = y + row * rowHeight;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(...mutedRGB);
        doc.text(kpi.label, x, cellY, { maxWidth: colWidth - 10 });

        doc.setFont("helvetica", "bold");
        doc.setFontSize(15);
        doc.setTextColor(...inkRGB);
        doc.text(kpi.value, x, cellY + 18);

        if (kpi.sub) {
          doc.setFont("helvetica", "italic");
          doc.setFontSize(8);
          doc.setTextColor(...mutedRGB);
          doc.text(kpi.sub, x, cellY + 30);
        }
      });

      y += rows * rowHeight + 10;
    }

    // ---- Project Summary (compact table) -----------------------------
    if (projects.length) {
      const headers = ["Project", "Spools", "Balance", "Packed", "Dispatched", "% Disp.", "Weight (MT)"];
      const colWidths = [contentWidth * 0.30, contentWidth * 0.11, contentWidth * 0.12, contentWidth * 0.11, contentWidth * 0.13, contentWidth * 0.11, contentWidth * 0.12];
      const rowHeight = 20;

      ensureSpace(40);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(...inkRGB);
      doc.text("Project Summary", margin, y);
      y += 8;
      doc.setDrawColor(224, 227, 232);
      doc.setLineWidth(1);
      doc.line(margin, y, pageWidth - margin, y);
      y += 16;

      const drawHeaderRow = () => {
        doc.setFillColor(243, 244, 249);
        doc.rect(margin, y - 14, contentWidth, rowHeight, "F");
        let x = margin + 6;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.setTextColor(...inkRGB);
        headers.forEach((h, i) => {
          doc.text(h, x, y);
          x += colWidths[i];
        });
        y += rowHeight;
      };

      ensureSpace(rowHeight);
      drawHeaderRow();

      projects.forEach((p, i) => {
        if (ensureSpace(rowHeight)) drawHeaderRow();
        if (i % 2 === 1) {
          doc.setFillColor(250, 250, 252);
          doc.rect(margin, y - 14, contentWidth, rowHeight, "F");
        }
        const cells = [
          p.project_name ? `${p.project_name}` : p.project_code,
          String(p.total_spools ?? 0),
          String(p.spools_pending ?? 0),
          String(p.spools_packed ?? 0),
          String(p.spools_dispatched ?? 0),
          `${(p.pct_dispatched ?? 0).toFixed(1)}%`,
          `${(p.total_weight_mt ?? 0).toFixed(2)}`,
        ];
        let x = margin + 6;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(...inkRGB);
        cells.forEach((cell, ci) => {
          doc.text(String(cell), x, y, { maxWidth: colWidths[ci] - 8 });
          x += colWidths[ci];
        });
        y += rowHeight;
      });

      y += 16;
    }

    // ---- Charts ------------------------------------------------------
    for (const section of sections) {
      ensureSpace(30);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(...inkRGB);
      doc.text(section.groupTitle, margin, y);
      y += 8;
      doc.setDrawColor(224, 227, 232);
      doc.setLineWidth(1);
      doc.line(margin, y, pageWidth - margin, y);
      y += 20;

      for (const chart of section.charts) {
        const canvas = chart.canvas;
        if (!canvas.width || !canvas.height) continue;

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
          doc.text(chart.hint, margin + cardPadding, textY, { maxWidth: contentWidth - cardPadding * 2 });
          textY += hintHeight;
        }

        const imgX = margin + (contentWidth - drawWidth) / 2;
        doc.addImage(imgData, "PNG", imgX, textY + 4, drawWidth, imgHeight);

        y += cardHeight + 16;
      }
    }

    // ---- Page numbers --------------------------------------------------
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...mutedRGB);
      doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - 20, { align: "right" });
      doc.text("Packing & Dispatch Dashboard", margin, pageHeight - 20);
    }

    const stamp = new Date().toISOString().slice(0, 10);
    doc.save(`packing-dispatch-${stamp}.pdf`);
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
        PackingApp.showToast("Couldn't build the PDF - see console for details", true);
      } finally {
        btn.classList.remove("is-loading");
      }
    });
  },
};

document.addEventListener("DOMContentLoaded", () => PackingPdfExport.init());
