import { inflateSync } from "node:zlib";

/** Decode an 8-bit RGBA PNG, as resvg writes them, into its pixels. */
export function decodePng(png: Uint8Array) {
  const view = Buffer.from(png);
  const width = view.readUInt32BE(16);
  const height = view.readUInt32BE(20);
  if (view[24] !== 8 || view[25] !== 6) throw new Error("not an 8-bit RGBA PNG");
  const idat: Buffer[] = [];
  for (let at = 8; at < view.length;) {
    const length = view.readUInt32BE(at);
    if (view.toString("latin1", at + 4, at + 8) === "IDAT")
      idat.push(view.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? pixels[y * stride + i - 4] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + i] : 0;
      const c = i >= 4 && y > 0 ? pixels[(y - 1) * stride + i - 4] : 0;
      const p = a + b - c;
      const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
      const predictor = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][
        filter
      ];
      pixels[y * stride + i] = (line[i] + predictor) & 0xff;
    }
  }
  const pixel = (x: number, y: number) => [
    ...pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4),
  ];
  return { width, height, pixels, pixel };
}
