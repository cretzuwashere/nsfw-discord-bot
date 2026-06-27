import { describe, expect, it } from 'vitest';
import { applyTttMove, emptyTtt, isValidTttMove, renderTtt, tttDraw, tttWinner } from './ttt.js';
import { c4Draw, c4Winner, dropC4, emptyC4, isValidC4Column, renderC4 } from './connect4.js';

describe('tic-tac-toe', () => {
  it('detects row/column/diagonal wins', () => {
    expect(tttWinner([1, 1, 1, 0, 0, 0, 0, 0, 0])).toBe(1); // top row
    expect(tttWinner([2, 0, 0, 2, 0, 0, 2, 0, 0])).toBe(2); // left column
    expect(tttWinner([1, 0, 0, 0, 1, 0, 0, 0, 1])).toBe(1); // main diagonal
    expect(tttWinner([0, 0, 2, 0, 2, 0, 2, 0, 0])).toBe(2); // anti diagonal
  });
  it('returns 0 when no winner', () => {
    expect(tttWinner(emptyTtt())).toBe(0);
  });
  it('validates and applies moves', () => {
    const b = emptyTtt();
    expect(isValidTttMove(b, 4)).toBe(true);
    const b2 = applyTttMove(b, 4, 1);
    expect(b2[4]).toBe(1);
    expect(isValidTttMove(b2, 4)).toBe(false);
    expect(isValidTttMove(b2, 9)).toBe(false);
    expect(isValidTttMove(b2, -1)).toBe(false);
  });
  it('detects a draw', () => {
    // X O X / X X O / O X O  → full, no winner
    const draw = [1, 2, 1, 1, 1, 2, 2, 1, 2];
    expect(tttWinner(draw)).toBe(0);
    expect(tttDraw(draw)).toBe(true);
  });
  it('renders a grid', () => {
    expect(renderTtt(emptyTtt()).split('\n')).toHaveLength(3);
  });
});

describe('connect four', () => {
  it('drops to the bottom then stacks', () => {
    const r1 = dropC4(emptyC4(), 0, 1)!;
    expect(r1.row).toBe(5);
    const r2 = dropC4(r1.board, 0, 2)!;
    expect(r2.row).toBe(4);
  });
  it('rejects a full column', () => {
    let board = emptyC4();
    for (let i = 0; i < 6; i++) board = dropC4(board, 3, 1)!.board;
    expect(isValidC4Column(board, 3)).toBe(false);
    expect(dropC4(board, 3, 1)).toBeNull();
  });
  it('detects a horizontal win', () => {
    let board = emptyC4();
    for (let c = 0; c < 4; c++) board = dropC4(board, c, 1)!.board;
    expect(c4Winner(board)).toBe(1);
  });
  it('detects a vertical win', () => {
    let board = emptyC4();
    for (let i = 0; i < 4; i++) board = dropC4(board, 2, 2)!.board;
    expect(c4Winner(board)).toBe(2);
  });
  it('detects a diagonal win', () => {
    // Build an ascending diagonal for player 1.
    let board = emptyC4();
    // column heights: c0=1, c1=2, c2=3, c3=4 of supporting discs, with 1 on the diagonal
    board = dropC4(board, 0, 1)!.board; // (5,0)=1
    board = dropC4(board, 1, 2)!.board; // (5,1)=2
    board = dropC4(board, 1, 1)!.board; // (4,1)=1
    board = dropC4(board, 2, 2)!.board; // (5,2)=2
    board = dropC4(board, 2, 2)!.board; // (4,2)=2
    board = dropC4(board, 2, 1)!.board; // (3,2)=1
    board = dropC4(board, 3, 2)!.board; // (5,3)=2
    board = dropC4(board, 3, 2)!.board; // (4,3)=2
    board = dropC4(board, 3, 2)!.board; // (3,3)=2
    board = dropC4(board, 3, 1)!.board; // (2,3)=1  → diagonal (5,0)(4,1)(3,2)(2,3)
    expect(c4Winner(board)).toBe(1);
  });
  it('renders a grid with a column legend', () => {
    expect(renderC4(emptyC4()).split('\n')).toHaveLength(C4_ROWS_PLUS_LEGEND());
  });
  it('reports draw on a full board with no winner is false for empty', () => {
    expect(c4Draw(emptyC4())).toBe(false);
  });
});

function C4_ROWS_PLUS_LEGEND(): number {
  return 6 + 1;
}
