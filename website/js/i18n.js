/*
 * i18n.js
 * ---------------------------------------------------------
 * English / Thai toggle for static UI chrome (nav, headers,
 * labels, buttons, tooltips) - not for dynamically-rendered
 * chart/table content, which stays English-only for now.
 *
 * Unlike theme.js's PER-PAGE storage, language is SITE-WIDE: one
 * localStorage key for the whole app, because a person's language
 * is a property of them, not of which dashboard tab they're on -
 * switching to Thai on the hub and then clicking into Production
 * should not silently switch back to English.
 *
 * Two parts, both in this one file:
 *   1. DICT - flat lookup of "key" -> {en, th} strings, grouped by
 *      comments per page/section for maintainability.
 *   2. The engine: apply(lang) walks every element carrying
 *      data-i18n (textContent), data-i18n-title (title attr),
 *      data-i18n-placeholder (placeholder attr), or
 *      data-i18n-aria-label (aria-label attr), and sets it from
 *      DICT. Re-run on every toggle click - no page reload needed,
 *      since nothing here touches Chart.js canvases.
 *
 * Usage: drop `<div class="lang-toggle" id="lang-toggle"></div>`
 * into a page's header (beside .theme-toggle), include this script
 * near the bottom of <body> AFTER js/user-menu.js (so its
 * DOMContentLoaded translation pass runs after user-menu.js has
 * built its dropdown - DOMContentLoaded listeners fire in
 * registration order). Other scripts can read window.I18N.t(key)
 * or listen for the "i18n:change" event on window.
 */
(function () {

  const KEY = "lang";

  const DICT = {

    // ---- shared across every page ----------------------------------
    "common.allDepartments": { en: "All Departments", th: "ทุกแผนก" },
    "common.dataAsOf": { en: "Data as of", th: "ข้อมูล ณ วันที่" },
    "common.retry": { en: "Retry", th: "ลองใหม่" },
    "common.clearSavedData": { en: "Clear Saved Data", th: "ล้างข้อมูลที่บันทึกไว้" },
    "common.clearSavedDataTitle": { en: "Forget the dashboard data saved in this browser", th: "ลบข้อมูลแดชบอร์ดที่บันทึกไว้ในเบราว์เซอร์นี้" },
    "common.exportPdf": { en: "Export PDF", th: "ส่งออก PDF" },
    "common.uploadData": { en: "Upload Data", th: "อัปโหลดข้อมูล" },
    "common.live": { en: "Live", th: "ใช้งานอยู่" },
    "common.comingSoon": { en: "Coming Soon", th: "เร็ว ๆ นี้" },
    "common.openDashboard": { en: "Open dashboard", th: "เปิดแดชบอร์ด" },
    "common.viewDepartment": { en: "View department", th: "ดูแผนก" },
    "common.overview": { en: "Overview", th: "ภาพรวม" },
    "common.project": { en: "Project", th: "โปรเจกต์" },
    "common.allProjects": { en: "All Projects", th: "ทุกโปรเจกต์" },
    "common.clearFilters": { en: "Clear filters", th: "ล้างตัวกรอง" },
    "common.sortBy": { en: "Sort by", th: "เรียงตาม" },
    "common.direction": { en: "Direction", th: "ทิศทาง" },
    "common.ascending": { en: "Ascending", th: "น้อยไปมาก" },
    "common.descending": { en: "Descending", th: "มากไปน้อย" },
    "common.status": { en: "Status", th: "สถานะ" },
    "common.planning": { en: "Planning", th: "การวางแผน" },
    "common.all": { en: "All", th: "ทั้งหมด" },
    "common.planned": { en: "Planned", th: "ตามแผน" },
    "common.unplanned": { en: "Unplanned", th: "นอกแผน" },
    "common.completed": { en: "Completed", th: "เสร็จสมบูรณ์" },
    "common.active": { en: "Active", th: "กำลังดำเนินการ" },
    "common.spools": { en: "Spools", th: "สปูล" },
    "common.day": { en: "Day", th: "วัน" },
    "common.week": { en: "Week", th: "สัปดาห์" },
    "common.month": { en: "Month", th: "เดือน" },
    "common.metric": { en: "Metric", th: "ตัวชี้วัด" },
    "common.period": { en: "Period", th: "ช่วงเวลา" },
    "common.inchDia": { en: "Inch Dia", th: "นิ้วเส้นผ่านศูนย์กลาง" },
    "common.surfaceArea": { en: "Surface Area", th: "พื้นที่ผิว" },
    "common.totalWt": { en: "Total Wt.", th: "น้ำหนักรวม" },
    "common.exportToExcel": { en: "Export to Excel", th: "ส่งออกเป็น Excel" },
    "common.footerPrecalc": { en: "Data is pre-calculated in Python — this page only displays it.", th: "ข้อมูลคำนวณล่วงหน้าด้วย Python — หน้านี้เป็นเพียงตัวแสดงผล" },
    "common.multi": { en: "(multi)", th: "(เลือกได้หลายรายการ)" },
    "common.days": { en: "(days)", th: "(วัน)" },
    "common.min": { en: "Min", th: "ต่ำสุด" },
    "common.max": { en: "Max", th: "สูงสุด" },

    // ---- user-menu.js (dynamically built) ---------------------------
    "usermenu.account": { en: "Account", th: "บัญชี" },
    "usermenu.signedInAs": { en: "Signed in as", th: "เข้าสู่ระบบในชื่อ" },
    "usermenu.unknownUser": { en: "Unknown user", th: "ไม่ทราบผู้ใช้" },
    "usermenu.logout": { en: "Logout", th: "ออกจากระบบ" },
    "usermenu.confirmLogout": { en: "Click to confirm", th: "คลิกเพื่อยืนยัน" },
    "usermenu.logoutFailed": { en: "Couldn't sign out - retry", th: "ออกจากระบบไม่สำเร็จ - ลองใหม่" },

    // ---- lang-toggle widget itself -----------------------------------
    "langtoggle.ariaLabel": { en: "Language", th: "ภาษา" },

    // ---- index.html (hub) --------------------------------------------
    "hub.eyebrow": { en: "Internal Portal", th: "พอร์ทัลภายใน" },
    "hub.heading": { en: "One hub for every department's numbers.", th: "ศูนย์รวมตัวเลขของทุกแผนกไว้ในที่เดียว" },
    "hub.sub": { en: "Live dashboards and analysis for DEE Piping Systems, Thailand — pick a department to get started.", th: "แดชบอร์ดและการวิเคราะห์แบบเรียลไทม์สำหรับ DEE Piping Systems ประเทศไทย — เลือกแผนกเพื่อเริ่มต้น" },
    "hub.deptProjects.name": { en: "Projects", th: "โปรเจกต์" },
    "hub.deptProjects.desc": { en: "Spool status, ageing, and live production intelligence across active project scopes.", th: "สถานะสปูล อายุงาน และข้อมูลการผลิตแบบเรียลไทม์ในทุกขอบเขตโปรเจกต์ที่กำลังดำเนินการ" },
    "hub.deptProduction.name": { en: "Production", th: "การผลิต" },
    "hub.deptProduction.desc": { en: "Spool ageing by category against the target-day matrix - distribution, stage-wise ageing, and ideal vs. actual cycle time.", th: "อายุงานสปูลแยกตามประเภทเทียบกับเป้าหมายจำนวนวัน - การกระจายตัว อายุงานแยกตามขั้นตอน และเวลาที่ใช้จริงเทียบกับเป้าหมาย" },
    "hub.deptQuality.name": { en: "Quality Assurance / Control", th: "การประกัน / ควบคุมคุณภาพ" },
    "hub.deptQuality.desc": { en: "Rework analysis from QC's inspection report - top defect types, rework rate by project, first-offer acceptance, and trend over time.", th: "การวิเคราะห์งานแก้ไขจากรายงานตรวจสอบของ QC - ประเภทข้อบกพร่องหลัก อัตรางานแก้ไขแยกตามโปรเจกต์ อัตราผ่านครั้งแรก และแนวโน้มตามช่วงเวลา" },
    "hub.deptPainting.name": { en: "Painting", th: "งานพ่นสี" },
    "hub.deptPainting.desc": { en: "Surface preparation, coating application, and DFT compliance across all painted assemblies.", th: "การเตรียมพื้นผิว การพ่นเคลือบ และความสอดคล้องของค่า DFT สำหรับชิ้นงานที่พ่นสีทั้งหมด" },
    "hub.deptPacking.name": { en: "Packing & Dispatch", th: "การแพ็คและจัดส่ง" },
    "hub.deptPacking.desc": { en: "Packing readiness, dispatch scheduling, and logistics tracking through to site delivery.", th: "ความพร้อมในการแพ็ค กำหนดการจัดส่ง และการติดตามโลจิสติกส์จนถึงการส่งมอบหน้างาน" },
    "hub.footer": { en: "DEE Piping Systems — Thailand · Internal Operations Portal", th: "DEE Piping Systems — ประเทศไทย · พอร์ทัลปฏิบัติการภายใน" },

    // ---- dashboard.html (Projects) ------------------------------------
    "dashboard.eyebrow": { en: "DEE Piping Systems — Live Production Intelligence", th: "DEE Piping Systems — ข้อมูลการผลิตแบบเรียลไทม์" },
    "dashboard.h1": { en: "Spool Status & Ageing", th: "สถานะและอายุงานของสปูล" },
    "dashboard.kpiTotal": { en: "Total Spools", th: "สปูลทั้งหมด" },
    "dashboard.kpiPlannedUnplanned": { en: "Planned / Unplanned", th: "ตามแผน / นอกแผน" },
    "dashboard.kpiCompleted": { en: "Completed", th: "เสร็จสมบูรณ์" },
    "dashboard.kpiAvgAge": { en: "Average Age", th: "อายุงานเฉลี่ย" },
    "dashboard.kpiAvgAgeSub": { en: "days", th: "วัน" },
    "dashboard.kpiOldest": { en: "Oldest Spool", th: "สปูลที่ค้างนานที่สุด" },
    "dashboard.kpiVariance": { en: "Planning Variance", th: "ส่วนต่างจากแผน" },
    "dashboard.kpiVarianceSub": { en: "avg. start vs. plan (− = ahead, + = behind)", th: "เริ่มงานจริงเทียบแผนเฉลี่ย (− = เร็วกว่าแผน, + = ช้ากว่าแผน)" },
    "dashboard.fablineEyebrow": { en: "The Shop Floor, Right Now", th: "หน้างานผลิต ณ ขณะนี้" },
    "dashboard.fablineHeading": { en: "Fabrication Line", th: "สายการผลิต" },
    "dashboard.fablineNote": { en: "Each block is a stage and shows how many spools are sitting there right now. The busiest stage is flagged Bottleneck.", th: "แต่ละบล็อกคือขั้นตอนหนึ่ง แสดงจำนวนสปูลที่อยู่ในขั้นตอนนั้น ณ ขณะนี้ ขั้นตอนที่มีงานค้างมากที่สุดจะถูกทำเครื่องหมายว่าคอขวด" },
    "dashboard.chartProjectProgress": { en: "Project Progress", th: "ความคืบหน้าโปรเจกต์" },
    "dashboard.chartWeeklyProgress": { en: "Weekly Progress", th: "ความคืบหน้ารายสัปดาห์" },
    "dashboard.chartWeeklyFrom": { en: "From", th: "จาก" },
    "dashboard.chartWeeklyTo": { en: "to", th: "ถึง" },
    "dashboard.chartAgeingDistribution": { en: "Ageing Distribution", th: "การกระจายตัวของอายุงาน" },
    "dashboard.materialHoldEmpty": { en: "No spools currently flagged Hold or MNA.", th: "ไม่มีสปูลที่ถูกทำเครื่องหมายพักงานหรือ MNA ในขณะนี้" },
    "dashboard.exportAllPdf": { en: "Export All Departments PDF", th: "ส่งออก PDF ทุกแผนก" },
    "dashboard.stageActivity": { en: "Stage Activity", th: "กิจกรรมตามขั้นตอน" },
    "dashboard.chartFitupDb": { en: "Fit-Up DB", th: "ฐานข้อมูลการประกอบ (Fit-Up)" },
    "dashboard.chartWeldingDb": { en: "Welding DB", th: "ฐานข้อมูลงานเชื่อม" },
    "dashboard.chartPainting": { en: "Painting", th: "งานพ่นสี" },
    "dashboard.stageThroughputEyebrow": { en: "All 7 Stages, In Sequence", th: "ครบทั้ง 7 ขั้นตอนตามลำดับ" },
    "dashboard.stageThroughputHeading": { en: "Stage Throughput", th: "ปริมาณงานตามขั้นตอน" },
    "dashboard.chartSpoolsByStage": { en: "Spools by Stage", th: "จำนวนสปูลตามขั้นตอน" },
    "dashboard.stageAgeingEyebrow": { en: "Project Wise, Stage Wise", th: "แยกตามโปรเจกต์และขั้นตอน" },
    "dashboard.stageAgeingHeading": { en: "Stage Ageing Summary", th: "สรุปอายุงานตามขั้นตอน" },
    "dashboard.chartAvgTimePerStage": { en: "Average Time per Stage", th: "เวลาเฉลี่ยต่อขั้นตอน" },
    "dashboard.chartDwellDist": { en: "Stage Dwell Time Distribution", th: "การกระจายตัวของเวลาค้างในแต่ละขั้นตอน" },
    "dashboard.chartAvgAgeByStage": { en: "Average Age by Stage", th: "อายุงานเฉลี่ยตามขั้นตอน" },
    "dashboard.chartSCurve": { en: "Project S-Curve", th: "กราฟ S-Curve ของโปรเจกต์" },
    "dashboard.scurvePlannedToDate": { en: "Planned to date", th: "ตามแผนจนถึงปัจจุบัน" },
    "dashboard.scurveActualToDate": { en: "Actual to date", th: "ผลจริงจนถึงปัจจุบัน" },
    "dashboard.scurveVariance": { en: "Schedule Variance", th: "ส่วนต่างจากกำหนดการ" },
    "dashboard.chartHoldMna": { en: "Hold & MNA by Project", th: "งานพักและ MNA แยกตามโปรเจกต์" },
    "dashboard.tabAll": { en: "All Spools", th: "สปูลทั้งหมด" },
    "dashboard.tabOldest": { en: "Oldest Spools", th: "สปูลค้างนานที่สุด" },
    "dashboard.tabExceptions": { en: "Exceptions", th: "รายการผิดปกติ" },
    "dashboard.filterWeek": { en: "Week", th: "สัปดาห์" },
    "dashboard.filterGroup": { en: "Group", th: "กลุ่ม" },
    "dashboard.filterMaterial": { en: "Material", th: "วัสดุ" },
    "dashboard.filterCurrentStage": { en: "Current Stage", th: "ขั้นตอนปัจจุบัน" },
    "dashboard.filterMaterialHoldStatus": { en: "Material Hold Status", th: "สถานะพักวัสดุ" },
    "dashboard.filterStageAge": { en: "Stage Age", th: "อายุในขั้นตอน" },
    "dashboard.filterTotalAge": { en: "Total Age", th: "อายุรวม" },

    // ---- production.html ------------------------------------------------
    "production.eyebrow": { en: "DEE Piping Systems — Production", th: "DEE Piping Systems — การผลิต" },
    "production.h1": { en: "Production", th: "การผลิต" },
    "production.kpiTotalSpoolsSub": { en: "Production Order Released", th: "ปล่อยคำสั่งผลิตแล้ว" },
    "production.kpiNotReleased": { en: "Not Yet Released", th: "ยังไม่ปล่อยงาน" },
    "production.kpiNotReleasedSub": { en: "excluded from this dashboard", th: "ไม่รวมในแดชบอร์ดนี้" },
    "production.kpiWithStart": { en: "With Planned Start", th: "มีวันเริ่มตามแผน" },
    "production.kpiMissingStart": { en: "Missing Planned Start", th: "ไม่มีวันเริ่มตามแผน" },
    "production.kpiMissingStartSub": { en: "released, but not in Master Planning Sheet or SIOP", th: "ปล่อยงานแล้ว แต่ไม่มีใน Master Planning Sheet หรือ SIOP" },
    "production.kpiPacked": { en: "Packed", th: "แพ็คแล้ว" },
    "production.kpiDelayed": { en: "Delayed vs. Target", th: "ล่าช้ากว่าเป้าหมาย" },
    "production.kpiWeldingProgress": { en: "Welding In Progress", th: "กำลังเชื่อม" },
    "production.kpiWeldingNotStarted": { en: "Welding Not Started", th: "ยังไม่เริ่มเชื่อม" },
    "production.subSpools": { en: "spools", th: "สปูล" },
    "production.subSpoolsCurrentStage": { en: "spools, current stage", th: "สปูล ขั้นตอนปัจจุบัน" },
    "production.showChartsIn": { en: "Show charts in", th: "แสดงกราฟเป็น" },
    "production.chartSpoolDistribution": { en: "Spool Distribution", th: "การกระจายตัวของสปูล" },
    "production.chartIdealVsActual": { en: "Ideal vs. Actual Time", th: "เวลาเป้าหมายเทียบเวลาจริง" },
    "production.chartDelayedInTime": { en: "Delayed vs. In Time by Project", th: "ล่าช้าเทียบตรงเวลา แยกตามโปรเจกต์" },
    "production.backlogByOperation": { en: "Backlog by Operation", th: "งานค้างแยกตามขั้นตอนปฏิบัติงาน" },
    "production.chartFitupWeldingBacklog": { en: "Fit-Up & Welding Backlog", th: "งานค้าง Fit-Up และงานเชื่อม" },
    "production.chartPdqcBacklog": { en: "PDQC Backlog", th: "งานค้าง PDQC" },
    "production.chartReleaseForPaintingBacklog": { en: "Release for Painting Backlog", th: "งานค้างปล่อยเข้าสู่งานพ่นสี" },
    "production.chartPaintingBacklog": { en: "Painting Backlog", th: "งานค้างพ่นสี" },
    "production.chartPackingBacklog": { en: "Packing Backlog", th: "งานค้างแพ็ค" },
    "production.currentlyOnHold": { en: "Currently on Hold", th: "กำลังพักงานอยู่ในขณะนี้" },
    "production.noSpoolsOnHold": { en: "No spools currently on Hold.", th: "ไม่มีสปูลที่ถูกพักงานในขณะนี้" },
    "production.currentlyInRework": { en: "Currently in Rework", th: "กำลังแก้ไขงานอยู่ในขณะนี้" },
    "production.noSpoolsInRework": { en: "No spools currently in Rework.", th: "ไม่มีสปูลที่กำลังแก้ไขงานในขณะนี้" },
    "production.materialHandover": { en: "Material Handover", th: "การส่งมอบวัสดุ" },
    "production.kpiMhTotal": { en: "Material Handover Items", th: "รายการส่งมอบวัสดุ" },
    "production.subSpoolsTracked": { en: "spools tracked", th: "สปูลที่ติดตาม" },
    "production.kpiMhHandedOver": { en: "Handed Over", th: "ส่งมอบแล้ว" },
    "production.subOfTrackedItems": { en: "of tracked items", th: "จากรายการที่ติดตาม" },
    "production.kpiMhPending": { en: "Pending / On Hold", th: "รอดำเนินการ / พักไว้" },
    "production.kpiMhHoldReasons": { en: "Open Hold Reasons", th: "เหตุผลการพักงานที่ยังเปิดอยู่" },
    "production.subDistinctAmongPending": { en: "distinct, among pending items", th: "รายการที่แตกต่างกัน ในรายการที่รอดำเนินการ" },
    "production.chartHandoverStatus": { en: "Handover Status", th: "สถานะการส่งมอบ" },
    "production.chartHandoverVolumeByMonth": { en: "Handover Volume by Month", th: "ปริมาณการส่งมอบแยกตามเดือน" },
    "production.chartTopPendingHoldReasons": { en: "Top Pending / Hold Reasons", th: "เหตุผลรอดำเนินการ / พักไว้ สูงสุด" },
    "production.chartByConcernDept": { en: "By Concern Department", th: "แยกตามแผนกที่เกี่ยวข้อง" },
    "production.chartByMaterial": { en: "By Material", th: "แยกตามวัสดุ" },
    "production.chartWeeklyHandoverInchDia": { en: "Weekly Handover (Inch Dia)", th: "การส่งมอบรายสัปดาห์ (นิ้วเส้นผ่านศูนย์กลาง)" },
    "production.chartHandoverTimeliness": { en: "Handover Timeliness", th: "ความตรงเวลาในการส่งมอบ" },
    "production.chartWeeklyFirstTimeVsIssue": { en: "Weekly First-Time Handover vs. Issue Found", th: "ส่งมอบผ่านครั้งแรกเทียบพบปัญหา รายสัปดาห์" },
    "production.chartWeeklyFirstPassYield": { en: "Weekly First-Pass Yield", th: "อัตราผ่านครั้งแรกรายสัปดาห์" },
    "production.stagewiseAgeingByCategory": { en: "Stage-wise Ageing by Category", th: "อายุงานตามขั้นตอน แยกตามประเภท" },
    "production.le8JointsCsSs": { en: "≤8 Joints (CS/SS)", th: "≤8 รอยต่อ (CS/SS)" },
    "production.gt8JointsCsSs": { en: ">8 Joints (CS/SS)", th: ">8 รอยต่อ (CS/SS)" },
    "production.le8JointsAlloy": { en: "≤8 Joints (Alloy)", th: "≤8 รอยต่อ (อัลลอย)" },
    "production.gt8JointsAlloy": { en: ">8 Joints (Alloy)", th: ">8 รอยต่อ (อัลลอย)" },
    "production.smallBore": { en: "Small Bore (CS/SS/AS)", th: "ท่อขนาดเล็ก (CS/SS/AS)" },
    "production.loose": { en: "Loose", th: "ชิ้นส่วนเดี่ยว" },
    "production.spoolList": { en: "Spool List", th: "รายการสปูล" },
    "production.clearAllFilters": { en: "Clear All Filters", th: "ล้างตัวกรองทั้งหมด" },
    "production.prev": { en: "Prev", th: "ก่อนหน้า" },
    "production.next": { en: "Next", th: "ถัดไป" },
    "production.footer": { en: "Data is pre-calculated in Python (src/production/) — this page only displays it. Reads the same DPR / Weekly Production Planning / Line History Sheet workbooks as the Projects dashboard.", th: "ข้อมูลคำนวณล่วงหน้าด้วย Python (src/production/) — หน้านี้เป็นเพียงตัวแสดงผล อ่านจากไฟล์ DPR / Weekly Production Planning / Line History Sheet ชุดเดียวกับแดชบอร์ดโปรเจกต์" },

    // ---- quality.html ----------------------------------------------------
    "quality.eyebrow": { en: "DEE Piping Systems — Quality Assurance / Control", th: "DEE Piping Systems — การประกัน / ควบคุมคุณภาพ" },
    "quality.h1": { en: "Quality", th: "คุณภาพ" },
    "quality.kpiSpoolsInspected": { en: "Spools Inspected", th: "สปูลที่ตรวจแล้ว" },
    "quality.kpiSpoolsInspectedSub": { en: "unique spools in the Rework Data report", th: "สปูลที่ไม่ซ้ำกันในรายงาน Rework Data" },
    "quality.kpiOfferEvents": { en: "Offer Events", th: "ครั้งที่ยื่นตรวจ" },
    "quality.kpiOfferEventsSub": { en: "total inspection offers, incl. re-offers", th: "จำนวนครั้งที่ยื่นตรวจทั้งหมด รวมยื่นซ้ำ" },
    "quality.kpiReworkEvents": { en: "Rework Events", th: "ครั้งที่ต้องแก้ไข" },
    "quality.kpiReworkEventsSub": { en: "offers returned for rework", th: "ครั้งที่ถูกตีกลับให้แก้ไข" },
    "quality.kpiReworkRate": { en: "Overall Rework Rate", th: "อัตรางานแก้ไขโดยรวม" },
    "quality.kpiReworkRateSub": { en: "rework events / offer events", th: "ครั้งที่แก้ไข / ครั้งที่ยื่นตรวจ" },
    "quality.kpiRepeatOffenders": { en: "Repeat Offenders", th: "สปูลที่แก้ไขซ้ำ" },
    "quality.kpiRepeatOffendersSub": { en: "spools needing 2+ reworks", th: "สปูลที่ต้องแก้ไข 2 ครั้งขึ้นไป" },
    "quality.kpiReportCoverage": { en: "Report Coverage", th: "ช่วงข้อมูลรายงาน" },
    "quality.kpiReportCoverageSub": { en: "Prod. Offer date range", th: "ช่วงวันที่ยื่นตรวจ" },
    "quality.downloadReworkData": { en: "Download Production Rework Data", th: "ดาวน์โหลดข้อมูล Production Rework" },
    "quality.top10ReworkTypes": { en: "Top 10 Rework Types", th: "ประเภทงานแก้ไขสูงสุด 10 อันดับ" },
    "quality.firstOfferOutcome": { en: "First Offer Outcome", th: "ผลการยื่นตรวจครั้งแรก" },
    "quality.reworkByProject": { en: "Rework by Project", th: "งานแก้ไขแยกตามโปรเจกต์" },
    "quality.openReworkHoldByProject": { en: "Open Rework & Hold by Project", th: "งานแก้ไขและพักงานที่ยังเปิดอยู่ แยกตามโปรเจกต์" },
    "quality.downloadOpenReworkHold": { en: "Download Open Rework & Hold", th: "ดาวน์โหลดงานแก้ไขและพักงานที่ยังเปิดอยู่" },
    "quality.trendRepeatCycles": { en: "Trend & Repeat Cycles", th: "แนวโน้มและรอบการแก้ไขซ้ำ" },
    "quality.reworkRateOverTime": { en: "Rework Rate Over Time", th: "อัตรางานแก้ไขตามช่วงเวลา" },
    "quality.groupBy": { en: "Group by", th: "จัดกลุ่มตาม" },
    "quality.reworkCyclesPerSpool": { en: "Rework Cycles per Spool", th: "รอบการแก้ไขต่อสปูล" },
    "quality.welderPerformance": { en: "Welder Performance", th: "ผลงานช่างเชื่อม" },
    "quality.downloadWelderPerformance": { en: "Download Welder Performance Record", th: "ดาวน์โหลดบันทึกผลงานช่างเชื่อม" },
    "quality.monthWiseJointRejectRate": { en: "Month Wise Joint Reject Rate", th: "อัตราปฏิเสธรอยต่อรายเดือน" },
    "quality.monthWiseNdtLengthReject": { en: "Month Wise NDT Length Reject %", th: "% ปฏิเสธความยาว NDT รายเดือน" },
    "quality.projectWiseRejectPct": { en: "Project Wise Reject %", th: "% ปฏิเสธแยกตามโปรเจกต์" },
    "quality.typeOfDefect": { en: "Type of Defect", th: "ประเภทข้อบกพร่อง" },
    "quality.rejectedJointsByWeldingProcess": { en: "Rejected Joints by Welding Process", th: "รอยต่อที่ถูกปฏิเสธ แยกตามกระบวนการเชื่อม" },
    "quality.footer": { en: "Data is pre-calculated in Python (src/quality/) — this page only displays it. Reads the Production Rework Data workbook, the same source that drives the PDQC override in the Projects pipeline.", th: "ข้อมูลคำนวณล่วงหน้าด้วย Python (src/quality/) — หน้านี้เป็นเพียงตัวแสดงผล อ่านจากไฟล์ Production Rework Data ชุดเดียวกับที่ใช้กำหนดค่า PDQC override ในไปป์ไลน์ของแดชบอร์ดโปรเจกต์" },

    // ---- packing-dispatch.html -------------------------------------------
    "packing.eyebrow": { en: "DEE Piping Systems — Packing & Dispatch", th: "DEE Piping Systems — การแพ็คและจัดส่ง" },
    "packing.h1": { en: "Packing & Dispatch", th: "การแพ็คและจัดส่ง" },
    "packing.downloadPdf": { en: "Download PDF", th: "ดาวน์โหลด PDF" },
    "packing.kpiTotalQty": { en: "Total Qty", th: "จำนวนรวม" },
    "packing.subPieces": { en: "pieces", th: "ชิ้น" },
    "packing.kpiTotalWeight": { en: "Total Weight", th: "น้ำหนักรวม" },
    "packing.kpiBalance": { en: "Balance in Project", th: "คงเหลือในโปรเจกต์" },
    "packing.kpiPacked": { en: "Packed", th: "แพ็คแล้ว" },
    "packing.kpiDispatched": { en: "Dispatched", th: "จัดส่งแล้ว" },
    "packing.kpiTotalBoxes": { en: "Total Boxes", th: "กล่องทั้งหมด" },
    "packing.kpiBoxesSplit": { en: "Boxes Packed / Dispatched", th: "กล่องแพ็คแล้ว / จัดส่งแล้ว" },
    "packing.kpiShipments": { en: "Total Shipments", th: "การขนส่งทั้งหมด" },
    "packing.subContainers": { en: "containers dispatched", th: "ตู้คอนเทนเนอร์ที่จัดส่งแล้ว" },
    "packing.kpiAvgBox": { en: "Avg. Weight / Box", th: "น้ำหนักเฉลี่ย / กล่อง" },
    "packing.kpiAvgShipment": { en: "Avg. Weight / Shipment", th: "น้ำหนักเฉลี่ย / การขนส่ง" },
    "packing.kpiWeightDispatched": { en: "Weight Dispatched", th: "น้ำหนักที่จัดส่งแล้ว" },
    "packing.chartPackingStatus": { en: "Packing Status", th: "สถานะการแพ็ค" },
    "packing.chartPackingTrend": { en: "Packing Trend", th: "แนวโน้มการแพ็ค" },
    "packing.chartSpoolsPackedOverTime": { en: "Spools Packed Over Time", th: "สปูลที่แพ็คแล้วตามช่วงเวลา" },
    "packing.chartDispatchTrend": { en: "Dispatch Trend", th: "แนวโน้มการจัดส่ง" },
    "packing.chartSpoolsDispatchedOverTime": { en: "Spools Dispatched Over Time", th: "สปูลที่จัดส่งแล้วตามช่วงเวลา" },
    "packing.shipments": { en: "Shipments", th: "การขนส่ง" },
    "packing.chartShipmentWeight": { en: "Shipment Weight Over Time", th: "น้ำหนักการขนส่งตามช่วงเวลา" },
    "packing.tabProjectSummary": { en: "Project Summary", th: "สรุปโปรเจกต์" },
    "packing.tabShipments": { en: "Shipments", th: "การขนส่ง" },
    "packing.tabBoxes": { en: "Boxes", th: "กล่อง" },
    "packing.tabAllSpools": { en: "All Spools", th: "สปูลทั้งหมด" },
    "packing.qtyPcs": { en: "Qty (pcs)", th: "จำนวน (ชิ้น)" },
    "packing.weightMt": { en: "Weight (MT)", th: "น้ำหนัก (ตัน)" },
    "packing.footer": { en: "Data is pre-calculated in Python (src/packing/) — this page only displays it.", th: "ข้อมูลคำนวณล่วงหน้าด้วย Python (src/packing/) — หน้านี้เป็นเพียงตัวแสดงผล" },

    // ---- painting.html ----------------------------------------------------
    "painting.eyebrow": { en: "DEE Piping Systems — Painting", th: "DEE Piping Systems — งานพ่นสี" },
    "painting.h1": { en: "Painting", th: "งานพ่นสี" },
    "painting.kpiRfpDone": { en: "RFP Done (DPR)", th: "RFP เสร็จแล้ว (DPR)" },
    "painting.kpiMissingPlan": { en: "Missing from Painting Plan", th: "ขาดจากแผนพ่นสี" },
    "painting.kpiExcludedPacked": { en: "Excluded (Already Packed)", th: "ไม่นับรวม (แพ็คแล้ว)" },
    "painting.subSpoolsNotCounted": { en: "spools, not counted below", th: "สปูล ไม่นับรวมด้านล่าง" },
    "painting.kpiPdiCleared": { en: "PDI Cleared", th: "ผ่าน PDI แล้ว" },
    "painting.kpiStillOpen": { en: "Still Open", th: "ยังค้างอยู่" },
    "painting.kpiStuck": { en: "Stuck > 8 working days", th: "ค้าง > 8 วันทำการ" },
    "painting.subOpenSpools": { en: "open spools", th: "สปูลที่ค้างอยู่" },
    "painting.kpiPickling": { en: "Pickling Done / Eligible", th: "ทำ/เข้าเกณฑ์ Pickling" },
    "painting.subNoPaintRoute": { en: "no-paint route spools", th: "สปูลที่ไม่ผ่านสาย พ่นสี" },
    "painting.kpiMedianCycle": { en: "Median RFP → PDI Clearance", th: "ค่ากลาง RFP → ผ่าน PDI" },
    "painting.subWorkingDaysIdeal4": { en: "working days · ideal is 4", th: "วันทำการ · เป้าหมาย 4 วัน" },
    "painting.kpiAvgCycle": { en: "Average RFP → PDI Clearance", th: "เฉลี่ย RFP → ผ่าน PDI" },
    "painting.subWorkingDays": { en: "working days", th: "วันทำการ" },
    "painting.kpiWithinIdeal": { en: "Within the 4-day Ideal", th: "อยู่ในเป้าหมาย 4 วัน" },
    "painting.subOfClearedSpools": { en: "of cleared spools", th: "ของสปูลที่ผ่านแล้ว" },
    "painting.chartQuantumPending": { en: "Quantum of Work Pending", th: "ปริมาณงานคงค้าง" },
    "painting.chartWhereStuck": { en: "Where Spools Are Currently Stuck", th: "จุดที่สปูลค้างอยู่ในขณะนี้" },
    "painting.allBays": { en: "All Bays", th: "ทุกเบย์" },
    "painting.stageFunnelHeading": { en: "Where Spools Are Getting Stuck", th: "จุดที่สปูลกำลังค้าง" },
    "painting.chartFunnel": { en: "Stage Completion Funnel", th: "ฟันเนลความสำเร็จตามขั้นตอน" },
    "painting.chartBottleneck": { en: "Median Days per Stage Transition", th: "ค่ากลางจำนวนวันต่อการเปลี่ยนขั้นตอน" },
    "painting.cycleTimeHeading": { en: "Cycle Time: Ideal vs. Actual", th: "รอบเวลา: เป้าหมายเทียบผลจริง" },
    "painting.chartHistogram": { en: "Completed Spools by Total Cycle Time", th: "สปูลที่เสร็จแล้วแยกตามรอบเวลารวม" },
    "painting.chartAging": { en: "Open Spools by Age Since RFP", th: "สปูลค้างแยกตามอายุนับจาก RFP" },
    "painting.chartTrend": { en: "Median Cycle Time by RFP Week", th: "ค่ากลางรอบเวลาแยกตามสัปดาห์ RFP" },
    "painting.processOutputHeading": { en: "Process Output Over Time", th: "ผลผลิตตามกระบวนการตามช่วงเวลา" },
    "painting.chartBlasting": { en: "Internal vs External Blasting", th: "การพ่นทรายภายในเทียบภายนอก" },
    "painting.chartPrimer": { en: "Primer", th: "รองพื้น" },
    "painting.chartPickling": { en: "Pickling", th: "Pickling" },
    "painting.chartPdiOffer": { en: "PDI Offer", th: "ยื่น PDI" },
    "painting.chartPdiClearance": { en: "PDI Clearance", th: "ผ่าน PDI" },
    "painting.outputByBay": { en: "Output by Bay", th: "ผลผลิตแยกตามเบย์" },
    "painting.stageInternalBlasting": { en: "Internal Blasting", th: "พ่นทรายภายใน" },
    "painting.stageExternalBlasting": { en: "External Blasting", th: "พ่นทรายภายนอก" },
    "painting.moreInsights": { en: "More Insights", th: "ข้อมูลเชิงลึกเพิ่มเติม" },
    "painting.chartCycleByProject": { en: "Median Cycle Time by Project", th: "ค่ากลางรอบเวลาแยกตามโปรเจกต์" },
    "painting.chartCycleByMaterial": { en: "Median Cycle Time by Material", th: "ค่ากลางรอบเวลาแยกตามวัสดุ" },
    "painting.tabAllRfpDone": { en: "All RFP-Done Spools", th: "สปูลที่ RFP เสร็จแล้วทั้งหมด" },
    "painting.tabMissingFromPlan": { en: "Missing from Plan", th: "ขาดจากแผน" },
    "painting.tabExcluded": { en: "Excluded (Already Packed)", th: "ไม่นับรวม (แพ็คแล้ว)" },
    "painting.tabStuck": { en: "Stuck / Long Open", th: "ค้าง / ค้างนาน" },
    "painting.tabExtreme": { en: "Extreme Cycle Time", th: "รอบเวลาผิดปกติ" },
    "painting.tabDataQuality": { en: "Data Quality Issues", th: "ปัญหาคุณภาพข้อมูล" },
    "painting.tabPdiMismatch": { en: "DPR / Painting PDI Mismatch", th: "PDI ไม่ตรงกัน (DPR / งานพ่นสี)" },
    "painting.tabNotInDpr": { en: "In Plan, Not RFP in DPR", th: "อยู่ในแผน แต่ไม่มี RFP ใน DPR" },
    "painting.filterItemCategory": { en: "Item Category", th: "ประเภทชิ้นงาน" },
    "painting.filterPaintingStatus": { en: "Painting Status", th: "สถานะงานพ่นสี" },
    "painting.filterInPaintingPlan": { en: "In Painting Plan", th: "อยู่ในแผนพ่นสี" },
    "painting.filterCompletion": { en: "Completion", th: "ความเสร็จสมบูรณ์" },
    "painting.filterCycleDays": { en: "Cycle Days", th: "จำนวนวันรอบงาน" },
    "painting.filterCurrentAge": { en: "Current Age", th: "อายุปัจจุบัน" },
    "painting.completed": { en: "Completed", th: "เสร็จสมบูรณ์" },
    "painting.open": { en: "Open", th: "ค้างอยู่" },
    "painting.yes": { en: "Yes", th: "ใช่" },
    "painting.no": { en: "No", th: "ไม่" },
    "painting.footer": { en: "Data is pre-calculated in Python (src/painting/) — this page only displays it.", th: "ข้อมูลคำนวณล่วงหน้าด้วย Python (src/painting/) — หน้านี้เป็นเพียงตัวแสดงผล" },

    // ---- login.html ----------------------------------------------------
    "login.tagline": { en: "Operations Hub — Sign In", th: "ศูนย์ปฏิบัติการ — เข้าสู่ระบบ" },
    "login.email": { en: "Email address", th: "ที่อยู่อีเมล" },
    "login.password": { en: "Password", th: "รหัสผ่าน" },
    "login.submit": { en: "Sign in", th: "เข้าสู่ระบบ" },
    "login.errInvalidEmail": { en: "That email address doesn't look right.", th: "ที่อยู่อีเมลนี้ดูไม่ถูกต้อง" },
    "login.errUserNotFound": { en: "No account found for that email.", th: "ไม่พบบัญชีสำหรับอีเมลนี้" },
    "login.errWrongPassword": { en: "Incorrect password. Try again.", th: "รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่" },
    "login.errInvalidCredential": { en: "Email or password is incorrect.", th: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" },
    "login.errTooManyRequests": { en: "Too many attempts. Wait a moment and try again.", th: "พยายามหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่" },
    "login.errGeneric": { en: "Couldn't sign in. Please try again.", th: "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่" },

  };

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function currentLang() {
    return stored() === "th" ? "th" : "en";
  }

  function t(key) {
    const entry = DICT[key];
    if (!entry) return key;
    return entry[currentLang()] || entry.en || key;
  }

  function apply(lang) {
    document.documentElement.setAttribute("lang", lang);

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
    });
    document.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria-label")));
    });
  }

  function setLang(lang) {
    const next = lang === "th" ? "th" : "en";
    if (next === currentLang()) return;
    try { localStorage.setItem(KEY, next); } catch (e) {
      // Storage blocked (private mode, etc.) - still apply for this view.
    }
    apply(next);
    window.dispatchEvent(new CustomEvent("i18n:change", { detail: { lang: next } }));
  }

  window.I18N = { get: currentLang, set: setLang, t: t };

  const LABELS = { en: "EN", th: "TH" };

  function buildWidget(mount) {
    mount.classList.add("lang-toggle");
    mount.setAttribute("role", "group");
    mount.setAttribute("aria-label", t("langtoggle.ariaLabel"));

    mount.innerHTML = ["en", "th"].map((lang) => (
      '<button type="button" class="lang-toggle__btn" data-lang-option="' + lang + '" aria-pressed="false">'
      + LABELS[lang]
      + "</button>"
    )).join("");

    const buttons = mount.querySelectorAll(".lang-toggle__btn");

    function sync() {
      const current = currentLang();
      buttons.forEach((btn) => {
        const isActive = btn.dataset.langOption === current;
        btn.classList.toggle("is-active", isActive);
        btn.setAttribute("aria-pressed", String(isActive));
      });
    }

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        setLang(btn.dataset.langOption);
        sync();
      });
    });

    sync();
  }

  document.addEventListener("DOMContentLoaded", function () {
    apply(currentLang());
    const mount = document.getElementById("lang-toggle");
    if (mount) buildWidget(mount);
  });

})();
