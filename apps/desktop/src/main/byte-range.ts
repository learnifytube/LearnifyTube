export type ByteRange = { start: number; end: number };

// An HTTP Range header ("bytes=start-end", "bytes=start-" or "bytes=-suffix")
// for a file of `size` bytes; null when it is malformed or unsatisfiable (416).
export const parseByteRange = (header: string, size: number): ByteRange | null => {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  const start = match[1] === "" ? Math.max(size - Number(match[2]), 0) : Number(match[1]);
  const end = match[1] === "" || match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  return start <= end && start < size ? { start, end } : null;
};
