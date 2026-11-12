/* SIOP Meeting Tracker: a small writer for styled .xlsx files.

   The Excel library bundled with the site (SheetJS community edition) cannot
   format cells, and the minutes need headings, borders, wrapped text, column
   widths, frozen headers and print settings. An .xlsx is a zip of XML files, so
   this writes them directly with JSZip (vendor/jszip.min.js).

   MomXlsx.build(JSZip, sheets) -> Promise of a zip (call .generateAsync on it)
   sheet = { name, cols: [widths], rows: [[cell, ...], ...], rowHeights: {rowNumber: points},
             freezeRow: n (rows above and including n stay visible), filterRow: n, hideGrid: bool }
   cell  = text | number | { v: text|number, s: styleName } | null (no cell)
   Style names: plain, title, subtitle, label, head, body, bodyBold, date, num, section, muted
   A number with style "date" is an Excel date serial number. */
(function (root) {
  "use strict";

  var STYLE = { plain: 0, title: 1, subtitle: 2, label: 3, head: 4, body: 5, bodyBold: 6, date: 7, num: 8, section: 9, muted: 10 };

  var MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  var REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  var HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  var STYLES_XML = HEAD +
    '<styleSheet xmlns="' + MAIN + '">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="dd\\-mmm\\-yyyy"/></numFmts>' +
    '<fonts count="7">' +
    '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="12"/><color rgb="FF7A1F21"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><i/><sz val="10"/><color rgb="FF666666"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="12"/><name val="Calibri"/><family val="2"/></font>' +
    '</fonts>' +
    '<fills count="5">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFA82E30"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF6E7E7"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2">' +
    '<border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right>' +
    '<top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="11">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
    '<xf numFmtId="0" fontId="4" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>' +
    '<xf numFmtId="0" fontId="6" fillId="4" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  function esc(text) {
    return String(text)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function colName(index) {
    var name = "";
    var n = index + 1;
    while (n > 0) {
      var m = (n - 1) % 26;
      name = String.fromCharCode(65 + m) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  }

  function cellXml(cell, row, col) {
    if (cell === null || cell === undefined) return "";
    var c = typeof cell === "object" ? cell : { v: cell };
    var ref = colName(col) + (row + 1);
    var s = STYLE[c.s || "plain"] || 0;
    var attrs = ' r="' + ref + '"' + (s ? ' s="' + s + '"' : "");
    if (c.v === undefined || c.v === null || c.v === "") return "<c" + attrs + "/>";
    if (typeof c.v === "number" && isFinite(c.v)) return "<c" + attrs + "><v>" + c.v + "</v></c>";
    return "<c" + attrs + ' t="inlineStr"><is><t xml:space="preserve">' + esc(c.v) + "</t></is></c>";
  }

  function width(sheet) {
    return Math.max(1, sheet.cols.length, sheet.rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0));
  }

  function sheetXml(sheet, selected) {
    var columns = width(sheet);
    var rowCount = sheet.rows.length;
    var last = colName(columns - 1) + Math.max(rowCount, 1);
    var heights = sheet.rowHeights || {};
    var rows = sheet.rows.map(function (cells, r) {
      var h = heights[r + 1];
      var attrs = ' r="' + (r + 1) + '"' + (h ? ' ht="' + h + '" customHeight="1"' : "");
      return "<row" + attrs + ">" + cells.map(function (cell, c) { return cellXml(cell, r, c); }).join("") + "</row>";
    }).join("");

    var pane = "";
    if (sheet.freezeRow) {
      pane = '<pane ySplit="' + sheet.freezeRow + '" topLeftCell="A' + (sheet.freezeRow + 1) + '" activePane="bottomLeft" state="frozen"/>' +
        '<selection pane="bottomLeft" activeCell="A' + (sheet.freezeRow + 1) + '" sqref="A' + (sheet.freezeRow + 1) + '"/>';
    }
    var cols = sheet.cols.map(function (w, i) {
      return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
    }).join("");
    var filter = sheet.filterRow
      ? '<autoFilter ref="A' + sheet.filterRow + ":" + colName(columns - 1) + Math.max(rowCount, sheet.filterRow) + '"/>' : "";

    return HEAD + '<worksheet xmlns="' + MAIN + '">' +
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
      '<dimension ref="A1:' + last + '"/>' +
      '<sheetViews><sheetView workbookViewId="0"' + (sheet.hideGrid ? ' showGridLines="0"' : "") + (selected ? ' tabSelected="1"' : "") + ">" + pane + "</sheetView></sheetViews>" +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      (cols ? "<cols>" + cols + "</cols>" : "") +
      "<sheetData>" + rows + "</sheetData>" + filter +
      '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
      '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>' +
      "<headerFooter><oddFooter>&amp;LSIOP Meeting Tracker&amp;CPage &amp;P of &amp;N&amp;R&amp;D</oddFooter></headerFooter>" +
      "</worksheet>";
  }

  function sheetName(name, used) {
    var base = String(name || "Sheet").replace(/[\[\]:*?\/\\]/g, "-").slice(0, 31) || "Sheet";
    var candidate = base;
    var n = 2;
    while (used.indexOf(candidate.toLowerCase()) !== -1) { candidate = base.slice(0, 28) + " " + n++; }
    used.push(candidate.toLowerCase());
    return candidate;
  }

  function build(JSZip, sheets) {
    var zip = new JSZip();
    // Add files without the empty folder entries JSZip creates by default.
    var add = zip.file.bind(zip);
    zip.file = function (name, data) { return add(name, data, { createFolders: false }); };
    var used = [];
    var names = sheets.map(function (s) { return sheetName(s.name, used); });

    zip.file("[Content_Types].xml", HEAD +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map(function (s, i) {
        return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      }).join("") +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      "</Types>");

    zip.file("_rels/.rels", HEAD +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="' + REL + '/officeDocument" Target="xl/workbook.xml"/></Relationships>');

    var defined = [];
    sheets.forEach(function (s, i) {
      var quoted = "'" + names[i].replace(/'/g, "''") + "'";
      if (s.freezeRow) defined.push('<definedName name="_xlnm.Print_Titles" localSheetId="' + i + '">' + esc(quoted) + "!$" + s.freezeRow + ":$" + s.freezeRow + "</definedName>");
      if (s.filterRow) {
        var columns = width(s);
        defined.push('<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">' + esc(quoted) +
          "!$A$" + s.filterRow + ":$" + colName(columns - 1) + "$" + Math.max(s.rows.length, s.filterRow) + "</definedName>");
      }
    });

    zip.file("xl/workbook.xml", HEAD +
      '<workbook xmlns="' + MAIN + '" xmlns:r="' + REL + '">' +
      '<bookViews><workbookView activeTab="0"/></bookViews>' +
      "<sheets>" + sheets.map(function (s, i) {
        return '<sheet name="' + esc(names[i]) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
      }).join("") + "</sheets>" +
      (defined.length ? "<definedNames>" + defined.join("") + "</definedNames>" : "") +
      "</workbook>");

    zip.file("xl/_rels/workbook.xml.rels", HEAD +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function (s, i) {
        return '<Relationship Id="rId' + (i + 1) + '" Type="' + REL + '/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
      }).join("") +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="' + REL + '/styles" Target="styles.xml"/></Relationships>');

    zip.file("xl/styles.xml", STYLES_XML);
    sheets.forEach(function (s, i) { zip.file("xl/worksheets/sheet" + (i + 1) + ".xml", sheetXml(s, i === 0)); });
    return zip;
  }

  var api = { build: build };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MomXlsx = api;
})(typeof window !== "undefined" ? window : this);
