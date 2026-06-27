/** Pure Connect Four logic. Board: 6 rows × 7 cols, row-major, 0/1/2. Row 0 is the top. */

export const C4_ROWS = 6;
export const C4_COLS = 7;

function idx(row: number, col: number): number {
  return row * C4_COLS + col;
}

export function emptyC4(): number[] {
  return new Array(C4_ROWS * C4_COLS).fill(0);
}

export function isValidC4Column(board: number[], col: number): boolean {
  return Number.isInteger(col) && col >= 0 && col < C4_COLS && board[idx(0, col)] === 0;
}

/** Drop a disc into a column. Returns the new board + landing row, or null if full/invalid. */
export function dropC4(
  board: number[],
  col: number,
  player: 1 | 2
): { board: number[]; row: number } | null {
  if (!isValidC4Column(board, col)) return null;
  for (let row = C4_ROWS - 1; row >= 0; row--) {
    if (board[idx(row, col)] === 0) {
      const next = [...board];
      next[idx(row, col)] = player;
      return { board: next, row };
    }
  }
  return null;
}

const DIRS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

export function c4Winner(board: number[]): number {
  const at = (r: number, c: number): number =>
    r >= 0 && r < C4_ROWS && c >= 0 && c < C4_COLS ? board[idx(r, c)]! : 0;
  for (let r = 0; r < C4_ROWS; r++) {
    for (let c = 0; c < C4_COLS; c++) {
      const p = at(r, c);
      if (p === 0) continue;
      for (const [dr, dc] of DIRS) {
        if (at(r + dr!, c + dc!) === p && at(r + 2 * dr!, c + 2 * dc!) === p && at(r + 3 * dr!, c + 3 * dc!) === p) {
          return p;
        }
      }
    }
  }
  return 0;
}

export function c4Draw(board: number[]): boolean {
  return c4Winner(board) === 0 && board.every((c) => c !== 0);
}

export function renderC4(board: number[]): string {
  const sym = ['⚪', '🔴', '🟡'];
  const rows: string[] = [];
  for (let r = 0; r < C4_ROWS; r++) {
    rows.push(Array.from({ length: C4_COLS }, (_, c) => sym[board[idx(r, c)]!]).join(''));
  }
  rows.push('1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣');
  return rows.join('\n');
}
