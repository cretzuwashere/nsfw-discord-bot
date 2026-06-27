/** Pure Tic-Tac-Toe logic. Board: 9 cells, 0 empty / 1 X / 2 O. */

export function emptyTtt(): number[] {
  return new Array(9).fill(0);
}

export function isValidTttMove(board: number[], cell: number): boolean {
  return Number.isInteger(cell) && cell >= 0 && cell < 9 && board[cell] === 0;
}

export function applyTttMove(board: number[], cell: number, player: 1 | 2): number[] {
  const next = [...board];
  next[cell] = player;
  return next;
}

const TTT_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

/** Returns 1 (X), 2 (O), or 0 (none). */
export function tttWinner(board: number[]): number {
  for (const [a, b, c] of TTT_LINES) {
    const v = board[a!]!;
    if (v !== 0 && v === board[b!] && v === board[c!]) return v;
  }
  return 0;
}

export function tttDraw(board: number[]): boolean {
  return tttWinner(board) === 0 && board.every((c) => c !== 0);
}

export function renderTtt(board: number[]): string {
  const sym = ['⬜', '❌', '⭕'];
  const rows: string[] = [];
  for (let r = 0; r < 3; r++) {
    rows.push([0, 1, 2].map((c) => sym[board[r * 3 + c]!]).join(''));
  }
  return rows.join('\n');
}
