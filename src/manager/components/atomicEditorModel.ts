import { tokenizeRich } from "../../widgets/richTokenize";

export interface TextAtom { kind: "text"; text: string }
export interface RefAtom { kind: "ref"; uuid: string; subCategories: string[] }
export interface VarAtom { kind: "var"; name: string }
export type Atom = TextAtom | RefAtom | VarAtom;

export function parse(text: string): Atom[] {
  if (!text) return [];
  const tokens = tokenizeRich(text);
  const out: Atom[] = [];
  let textBuf = "";
  const flush = () => {
    if (textBuf.length > 0) {
      out.push({ kind: "text", text: textBuf });
      textBuf = "";
    }
  };
  for (const tok of tokens) {
    if (tok.kind === "ref") {
      flush();
      const uuid = (tok.meta as { uuid?: string } | undefined)?.uuid ?? "";
      const subRaw = (tok.meta as { sub_categories?: string[] } | undefined)?.sub_categories;
      out.push({
        kind: "ref",
        uuid,
        subCategories: Array.isArray(subRaw) ? subRaw : [],
      });
    } else if (tok.kind === "var") {
      flush();
      const name = (tok.meta as { name?: string } | undefined)?.name ?? "";
      out.push({ kind: "var", name });
    } else {
      // text / escape / dp-* — collapse back into the running text buffer
      textBuf += tok.raw;
    }
  }
  flush();
  return out;
}

export function serialise(atoms: Atom[]): string {
  let out = "";
  for (const a of atoms) {
    if (a.kind === "text") out += a.text;
    else if (a.kind === "var") out += "$" + a.name;
    else if (a.kind === "ref") {
      out += "@{" + a.uuid;
      if (a.subCategories.length > 0) out += ":" + a.subCategories.join(",");
      out += "}";
    }
  }
  return out;
}
