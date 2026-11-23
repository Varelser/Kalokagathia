// Minimal ambient types for opentype.js v2 — the package ships
// no TypeScript declarations, and the community @types package
// targets the v1 API. Only the surface lib/textExtrude.ts uses
// is declared here (parse, Font metrics / glyph access, Glyph
// outline paths). Everything else in the library stays untyped
// on purpose: widening this declaration is a deliberate step,
// not an accident of use.
declare module 'opentype.js' {
  export interface PathCommand {
    type: 'M' | 'L' | 'C' | 'Q' | 'Z';
    x?: number;
    y?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
  }

  export interface GlyphPath {
    commands: PathCommand[];
    toPathData(decimalPlaces?: number): string;
  }

  export class Glyph {
    index: number;
    advanceWidth: number;
    getPath(x: number, y: number, fontSize: number): GlyphPath;
  }

  export class Font {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    names: Record<string, unknown>;
    getEnglishName(nameId: string): string | null;
    charToGlyph(char: string): Glyph;
    getKerningValue(leftGlyph: Glyph, rightGlyph: Glyph): number;
  }

  export function parse(buffer: ArrayBuffer): Font;

  const opentype: { parse: typeof parse };
  export default opentype;
}
