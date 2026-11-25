// Reading a small .xlsx file without a library (task.md T8.12: the EU Weekly Oil Bulletin is published as one): an .xlsx
// is a zip of XML files. Only what a plain one-sheet table needs: the zip's entries (stored or deflated, no zip64), the
// shared strings, and each row's cells by column letter. A file that is not that throws, and the caller treats it as a
// source that changed.
import { inflateRawSync } from "node:zlib";

/** The zip's files by name; throws on what is not a zip it can read */
export function zipEntries(zip: Buffer): Map<string, Buffer> {
  // The end of central directory record is in the last 64 KB (its comment is at most 65,535 bytes)
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not a zip file");
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error("broken zip directory");
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error("broken zip entry");
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    if (method === 0) files.set(name, data);
    else if (method === 8) files.set(name, inflateRawSync(data));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const unescape = (text: string) =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");

/** The text of every `<t>` inside a piece of XML (a shared string can be split into runs) */
const textOf = (xml: string) => unescape([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => match[1]).join(""));

/**
 * The first sheet's rows, by row number, each a map from column letter to its text (numbers as written in the file).
 * Throws when the file is not a spreadsheet.
 */
export function firstSheetRows(xlsx: Buffer): Map<number, Map<string, string>> {
  const files = zipEntries(xlsx);
  const sheet = files.get("xl/worksheets/sheet1.xml");
  if (!sheet) throw new Error("no first sheet in the spreadsheet");
  const shared = [...(files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => textOf(match[1]));

  const rows = new Map<number, Map<string, string>>();
  for (const [, rowNumber, body] of sheet.toString("utf8").matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = new Map<string, string>();
    for (const [, column, attributes, inner] of body.matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      if (inner === undefined) continue;
      const value = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      const type = /\bt="(\w+)"/.exec(attributes)?.[1];
      const text = type === "s" && value !== undefined ? (shared[Number(value)] ?? "") : type === "inlineStr" ? textOf(inner) : value !== undefined ? unescape(value) : "";
      cells.set(column, text);
    }
    rows.set(Number(rowNumber), cells);
  }
  return rows;
}
