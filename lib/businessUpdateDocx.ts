// Builds the Bi-Weekly Business Update as a Word file from ALG's own template
// (public/templates/business-update.docx): letterhead, footer, fonts and styles stay as designed;
// only the body text, the header table and the footer title are written in.

import JSZip from "jszip";
import type { BusinessUpdate } from "../convex/ai";
import { slashDate, stamp } from "../convex/lib/wording";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const run = (text: string, bold = false) =>
  `<w:r>${bold ? "<w:rPr><w:b/><w:bCs/></w:rPr>" : ""}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;

const para = (text = "") => (text ? `<w:p>${run(text)}</w:p>` : "<w:p/>");
const title = (text: string) => `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${run(text)}</w:p>`;
const h1 = (text: string) => `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${run(text)}</w:p>`;
const h2 = (text: string) => `<w:p><w:pPr><w:pStyle w:val="Heading2"/><w:spacing w:before="200"/></w:pPr>${run(text)}</w:p>`;

/** A bullet in the template's list style; level 1 for sub-points. A lead is set in bold. */
function bullet(text: string, lead = "", level = 0) {
  const body = lead ? run(lead, true) + (text ? run(` ${text}`) : "") : run(text);
  return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="4"/></w:numPr></w:pPr>${body}</w:p>`;
}

const BORDER = (color: string, size = 1) =>
  ["top", "left", "bottom", "right"].map((s) => `<w:${s} w:val="single" w:sz="${size}" w:space="0" w:color="${color}"/>`).join("");

function infoRow(label: string, value: string) {
  const cell = (w: number, text: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/><w:tcBorders>${BORDER("D0DAF0")}</w:tcBorders>` +
    `<w:tcMar><w:top w:w="80" w:type="dxa"/><w:left w:w="160" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar>` +
    `<w:vAlign w:val="center"/></w:tcPr>${para(text)}</w:tc>`;
  return `<w:tr>${cell(2400, label)}${cell(7380, value)}</w:tr>`;
}

function infoTable(rows: [string, string][]) {
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="9780" w:type="dxa"/><w:tblBorders>${BORDER("D0DAF0")}` +
    `<w:insideH w:val="single" w:sz="1" w:space="0" w:color="D0DAF0"/><w:insideV w:val="single" w:sz="1" w:space="0" w:color="D0DAF0"/></w:tblBorders>` +
    `<w:tblCellMar><w:left w:w="10" w:type="dxa"/><w:right w:w="10" w:type="dxa"/></w:tblCellMar>` +
    `<w:tblLook w:val="0600" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="7380"/></w:tblGrid>${rows.map(([l, v]) => infoRow(l, v)).join("")}</w:tbl>`
  );
}

/** The shaded summary boxes: green for wins, peach for blockers, as in the template. */
function box(fill: string, inner: string) {
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="9780" w:type="dxa"/><w:tblBorders>${BORDER("000000", 4)}</w:tblBorders>` +
    `<w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="9780"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="9780" w:type="dxa"/>` +
    `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` +
    `<w:tcMar><w:top w:w="120" w:type="dxa"/><w:left w:w="144" w:type="dxa"/><w:bottom w:w="120" w:type="dxa"/><w:right w:w="144" w:type="dxa"/></w:tcMar>` +
    `</w:tcPr>${inner}</w:tc></w:tr></w:tbl>`
  );
}

export function documentTitle(u: Pick<BusinessUpdate, "name" | "ending">) {
  return `Bi-Weekly Business Update: ${u.name} ${stamp(u.ending)}`;
}

export function fileName(u: Pick<BusinessUpdate, "name" | "ending">) {
  return `${u.name.trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}_Business_Update.${stamp(u.ending)}.docx`;
}

/** The body XML, in the order and with the headings of the ALG report. */
export function bodyXml(u: BusinessUpdate): string {
  const out: string[] = [];
  out.push(title(documentTitle(u)), para());
  const rows: [string, string][] = [["Submitted by", u.name]];
  if (u.title) rows.push(["Title", u.title]);
  rows.push(["Reporting period", `Two weeks ending ${slashDate(u.ending)}`]);
  out.push(infoTable(rows), para());

  out.push(h1("Executive Summary"));
  out.push(h2("Key wins"));
  out.push(box("D9F2D0", u.keyWins.length ? u.keyWins.map((i) => bullet(i.text, i.lead)).join("") : para("None this period.")));
  out.push(h2("Issues and Blockers"));
  out.push(box("FAE2D5", u.issues.length ? u.issues.map((i) => bullet(i.text, i.lead)).join("") : para("None this period.")));
  out.push(para());

  out.push(h1("Business Updates"));
  if (u.workstreams.length === 0) out.push(para("No updates logged this period."));
  for (const w of u.workstreams) {
    out.push(h2(w.heading));
    for (const i of w.items) {
      out.push(bullet(i.text, i.lead));
      for (const s of i.subpoints) out.push(bullet(s, "", 1));
    }
  }

  out.push(para(), h1("Next two weeks"));
  out.push(h2("Business Priorities"));
  out.push(u.priorities.length ? u.priorities.map((p) => bullet(p)).join("") : para("To be confirmed."));
  if (u.events.length) {
    out.push(h2("Business Events"));
    out.push(...u.events.map((e) => bullet(e.text, e.lead)));
  }
  if (u.travel.length) {
    out.push(h2("Business Travel"));
    out.push(...u.travel.map((t) => bullet(t.text, t.lead)));
  }
  if (u.leave.length) {
    out.push(h2(`Upcoming Leave (${u.quarter})`));
    out.push(...u.leave.map((l) => bullet(l)));
  }
  out.push("<w:p/>");
  return out.join("");
}

/** Fills the template and returns the finished .docx. */
export async function buildDocx(template: ArrayBuffer, u: BusinessUpdate): Promise<Blob> {
  const zip = await JSZip.loadAsync(template);
  const fill = async (path: string, values: Record<string, string>) => {
    const file = zip.file(path);
    if (!file) return;
    let xml = await file.async("string");
    for (const [k, v] of Object.entries(values)) xml = xml.split(`{{${k}}}`).join(v);
    zip.file(path, xml);
  };
  const name = esc(u.name);
  const st = stamp(u.ending);
  await fill("word/document.xml", { BODY: bodyXml(u) });
  for (const f of Object.keys(zip.files).filter((p) => /^word\/(footer|header)\d*\.xml$/.test(p))) {
    await fill(f, { NAME: name, STAMP: st });
  }
  await fill("docProps/core.xml", { NAME: name, STAMP: st, NOW: new Date().toISOString().replace(/\.\d+Z$/, "Z") });
  return await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}
