import { Component, ChangeDetectionStrategy, signal, computed, output, input, effect, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatchmakingService } from '../../services/matchmaking.service';
import { User } from '../../services/user.service';

type Player = 'w' | 'b';
type PieceType = 'p' | 'r' | 'n' | 'b' | 'q' | 'k';
interface Piece {
  type: PieceType;
  color: Player;
  hasMoved?: boolean;
}
type Square = Piece | null;
type Board = Square[][];
interface Position {
  row: number;
  col: number;
}
interface Move {
  from: Position;
  to: Position;
}

@Component({
  selector: 'app-game-board',
  templateUrl: './game-board.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
})
export class GameBoardComponent implements OnDestroy {
  // Inputs
  gameMode = input.required<'local' | 'online'>();
  roomId = input<string | null>(null);
  playerColor = input<'w' | 'b' | null>(null);
  opponent = input<User | null>(null);
  gameExit = output<void>();

  private matchmakingService = inject(MatchmakingService);

  // Game State Signals
  board = signal<Board>(this.createInitialBoard());
  currentPlayer = signal<Player>('w');
  selectedSquare = signal<Position | null>(null);
  legalMoves = signal<Position[]>([]);
  gameState = signal<'playing' | 'check' | 'checkmate' | 'stalemate' | 'promotion'>('playing');
  winner = signal<Player | null>(null);
  promotionSquare = signal<Position | null>(null);
  lastMove = signal<Move | null>(null);
  opponentLeftMessage = signal<string | null>(null);

  // Drag & Drop Signals
  draggedPiece = signal<Position | null>(null);
  private isTouchDragging = signal(false);
  private touchStartCoords = signal<{ x: number; y: number } | null>(null);
  floatingPiece = signal<{ piece: Piece; x: number; y: number } | null>(null);
  private boardElement = signal<HTMLElement | null>(null);

  isMyTurn = computed(() => {
    if (this.gameMode() === 'local') return true;
    return this.playerColor() === this.currentPlayer();
  });

  constructor() {
    effect(() => {
        if (this.gameMode() === 'online') {
            const gameData = this.matchmakingService.gameData();
            if (gameData) {
                this.board.set(gameData.board);
                this.currentPlayer.set(gameData.currentPlayer);
                this.gameState.set(gameData.gameState);
                this.lastMove.set(gameData.lastMove);
                this.winner.set(gameData.winner);
                this.promotionSquare.set(gameData.promotionSquare);

                // If opponent disconnects, matchmaking service will set winner.
                if (gameData.winner && (gameData.gameState === 'checkmate' || gameData.gameState === 'stalemate') && gameData.opponentLeft) {
                    const winnerPlayer = gameData.winner === 'w' ? 'White' : 'Black';
                    const loserName = this.opponent()?.username;
                    this.opponentLeftMessage.set(`${loserName} left the game. ${winnerPlayer} wins!`);
                } else {
                    this.opponentLeftMessage.set(null);
                }
            }
        }
    });
  }

  ngOnDestroy(): void {
      if (this.gameMode() === 'online') {
          this.matchmakingService.stopPresenceUpdates();
      }
  }

  pieceImageMap: { [key in Player]: { [key in PieceType]: string } } = {
    w: { p: 'https://upload.wikimedia.org/wikipedia/commons/4/45/Chess_plt45.svg', r: 'https://upload.wikimedia.org/wikipedia/commons/7/72/Chess_rlt45.svg', n: 'https://upload.wikimedia.org/wikipedia/commons/7/70/Chess_nlt45.svg', b: 'https://upload.wikimedia.org/wikipedia/commons/b/b1/Chess_blt45.svg', q: 'https://upload.wikimedia.org/wikipedia/commons/1/15/Chess_qlt45.svg', k: 'https://upload.wikimedia.org/wikipedia/commons/4/42/Chess_klt45.svg' },
    b: { p: 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Chess_pdt45.svg', r: 'https://upload.wikimedia.org/wikipedia/commons/f/ff/Chess_rdt45.svg', n: 'https://upload.wikimedia.org/wikipedia/commons/e/ef/Chess_ndt45.svg', b: 'https://upload.wikimedia.org/wikipedia/commons/9/98/Chess_bdt45.svg', q: 'https://upload.wikimedia.org/wikipedia/commons/4/47/Chess_qdt45.svg', k: 'https://upload.wikimedia.org/wikipedia/commons/f/f0/Chess_kdt45.svg' },
  };

  isSquareLegalMove = computed(() => {
    const moves = this.legalMoves();
    return (row: number, col: number) => moves.some(m => m.row === row && m.col === col);
  });

  floatingPieceStyle = computed(() => {
    const pieceInfo = this.floatingPiece();
    if (!pieceInfo) return { display: 'none' };
    return { display: 'block', position: 'fixed', left: `${pieceInfo.x}px`, top: `${pieceInfo.y}px`, transform: 'translate(-50%, -50%)', pointerEvents: 'none', width: '10vw', height: '10vw', maxWidth: '75px', maxHeight: '75px', zIndex: '1000' };
  });

  handleSquareClick(row: number, col: number): void {
    if (this.gameMode() === 'online' && !this.isMyTurn()) return;
    if (this.gameState() === 'promotion' || this.gameState() === 'checkmate' || this.gameState() === 'stalemate') return;

    const selectedPos = this.selectedSquare();
    const pieceAtClick = this.board()[row][col];

    if (selectedPos && this.isSquareLegalMove()(row, col)) {
      this.movePiece(selectedPos, { row, col });
      return;
    }

    if (pieceAtClick && pieceAtClick.color === this.currentPlayer()) {
      this.selectedSquare.set({ row, col });
      this.calculateLegalMoves({ row, col });
    } else {
      this.selectedSquare.set(null);
      this.legalMoves.set([]);
    }
  }

  movePiece(from: Position, to: Position): void {
    const newBoard = this.board().map(r => r.map(p => p ? {...p} : null));
    const pieceToMove = newBoard[from.row][from.col];
    if (!pieceToMove) return;

    if ((pieceToMove.type === 'k' || pieceToMove.type === 'r') && !pieceToMove.hasMoved) {
      pieceToMove.hasMoved = true;
    }

    if (pieceToMove.type === 'k' && Math.abs(from.col - to.col) === 2) {
      const rookCol = to.col > from.col ? 7 : 0;
      const newRookCol = to.col > from.col ? 5 : 3;
      const rook = newBoard[from.row][rookCol];
      if (rook) {
        newBoard[from.row][newRookCol] = rook;
        newBoard[from.row][rookCol] = null;
        rook.hasMoved = true;
      }
    }

    if (pieceToMove.type === 'p' && from.col !== to.col && !newBoard[to.row][to.col]) {
      newBoard[from.row][to.col] = null;
    }

    newBoard[to.row][to.col] = pieceToMove;
    newBoard[from.row][from.col] = null;
    
    this.selectedSquare.set(null);
    this.legalMoves.set([]);
    this.lastMove.set({ from, to });

    const promotionRank = pieceToMove.color === 'w' ? 0 : 7;
    if (pieceToMove.type === 'p' && to.row === promotionRank) {
        this.board.set(newBoard);
        this.gameState.set('promotion');
        this.promotionSquare.set(to);
        if (this.gameMode() === 'online') {
            this.matchmakingService.updateGameState({
                board: newBoard,
                gameState: 'promotion',
                promotionSquare: to,
                lastMove: { from, to },
                currentPlayer: this.currentPlayer()
            });
        }
    } else {
      this.updateGameStateAfterMove(newBoard, { from, to });
    }
  }

  handlePromotion(pieceType: PieceType) {
    const square = this.promotionSquare();
    if (!square) return;

    const newBoard = this.board().map(r => [...r]);
    const originalPawn = newBoard[square.row][square.col];
    if (!originalPawn) return;

    newBoard[square.row][square.col] = { type: pieceType, color: originalPawn.color };
    this.promotionSquare.set(null);
    this.updateGameStateAfterMove(newBoard, this.lastMove()!);
  }
  
  updateGameStateAfterMove(board: Board, lastMove: Move) {
    const newPlayer = this.currentPlayer() === 'w' ? 'b' : 'w';
    const allLegalMoves = this.getAllLegalMovesForPlayer(newPlayer, board);
    let newGameState: 'playing' | 'check' | 'checkmate' | 'stalemate' | 'promotion' = 'playing';
    let newWinner: Player | null = null;
    
    if (allLegalMoves.length === 0) {
      if (this.isKingInCheck(newPlayer, board)) {
        newGameState = 'checkmate';
        newWinner = this.currentPlayer();
      } else {
        newGameState = 'stalemate';
      }
    } else {
      newGameState = this.isKingInCheck(newPlayer, board) ? 'check' : 'playing';
    }

    if(this.gameMode() === 'local') {
        this.board.set(board);
        this.currentPlayer.set(newPlayer);
        this.gameState.set(newGameState);
        this.winner.set(newWinner);
        this.lastMove.set(lastMove);
    } else {
        this.matchmakingService.updateGameState({
            board: board,
            currentPlayer: newPlayer,
            gameState: newGameState,
            winner: newWinner,
            lastMove: lastMove,
            promotionSquare: null
        })
    }
  }


  // The rest of the game logic methods (calculateLegalMoves, etc.) are pure functions based on board state
  // and do not need to be modified. I'm omitting them for brevity but they are still part of the component.
  // ... (generatePseudoLegalMoves, getAllLegalMovesForPlayer, simulateMove, etc.)
  calculateLegalMoves(pos: Position): void {
    const piece = this.board()[pos.row][pos.col];
    if (!piece || piece.color !== this.currentPlayer()) {
      this.legalMoves.set([]);
      return;
    }

    const board = this.board();
    const pseudoLegalMoves = this.generatePseudoLegalMoves(pos, board);
    const legalMoves = pseudoLegalMoves.filter(move => {
      const tempBoard = this.simulateMove({ from: pos, to: move }, board);
      return !this.isKingInCheck(piece.color, tempBoard);
    });

    this.legalMoves.set(legalMoves);
  }

  generatePseudoLegalMoves(pos: Position, board: Board): Position[] {
    const piece = board[pos.row][pos.col];
    if (!piece) return [];
    const moves: Position[] = [];

    const addSlidingMoves = (directions: number[][]) => {
      directions.forEach(([dr, dc]) => {
        let currentPos = { row: pos.row + dr, col: pos.col + dc };
        while (this.isValid(currentPos.row, currentPos.col)) {
          const targetPiece = board[currentPos.row][currentPos.col];
          if (targetPiece) {
            if (targetPiece.color !== piece.color) moves.push({ ...currentPos });
            break;
          }
          moves.push({ ...currentPos });
          currentPos = { row: currentPos.row + dr, col: currentPos.col + dc };
        }
      });
    };

    switch (piece.type) {
      case 'p':
        const dir = piece.color === 'w' ? -1 : 1;
        const startRow = piece.color === 'w' ? 6 : 1;
        if (this.isValid(pos.row + dir, pos.col) && !board[pos.row + dir][pos.col]) {
          moves.push({ row: pos.row + dir, col: pos.col });
          if (pos.row === startRow && !board[pos.row + 2 * dir][pos.col]) {
            moves.push({ row: pos.row + 2 * dir, col: pos.col });
          }
        }
        [-1, 1].forEach(side => {
          const cPos = { row: pos.row + dir, col: pos.col + side };
          if (this.isValid(cPos.row, cPos.col) && board[cPos.row][cPos.col] && board[cPos.row][cPos.col]?.color !== piece.color) {
            moves.push(cPos);
          }
        });
        const last = this.lastMove();
        if (last) {
          const lastMovedPieceOnBoard = board[last.to.row][last.to.col];
          if (lastMovedPieceOnBoard?.type === 'p' && Math.abs(last.from.row - last.to.row) === 2 && pos.row === last.to.row && Math.abs(pos.col - last.to.col) === 1) {
            moves.push({ row: pos.row + dir, col: last.to.col });
          }
        }
        break;
      case 'r': addSlidingMoves([[-1, 0], [1, 0], [0, -1], [0, 1]]); break;
      case 'b': addSlidingMoves([[-1, -1], [-1, 1], [1, -1], [1, 1]]); break;
      case 'q': addSlidingMoves([[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]); break;
      case 'n':
        [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]].forEach(([dr, dc]) => {
          const newPos = { row: pos.row + dr, col: pos.col + dc };
          if (this.isValid(newPos.row, newPos.col) && board[newPos.row][newPos.col]?.color !== piece.color) {
            moves.push(newPos);
          }
        });
        break;
      case 'k':
        [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]].forEach(([dr, dc]) => {
          const newPos = { row: pos.row + dr, col: pos.col + dc };
          if (this.isValid(newPos.row, newPos.col) && board[newPos.row][newPos.col]?.color !== piece.color) {
            moves.push(newPos);
          }
        });
        if (!piece.hasMoved && !this.isKingInCheck(piece.color, board)) {
          // King-side
          if (!board[pos.row][5] && !board[pos.row][6] && board[pos.row][7]?.type === 'r' && !board[pos.row][7]?.hasMoved) {
            if (!this.isPositionUnderAttack({ row: pos.row, col: 5 }, piece.color, board) && !this.isPositionUnderAttack({ row: pos.row, col: 6 }, piece.color, board)) {
              moves.push({ row: pos.row, col: 6 });
            }
          }
          // Queen-side
          if (!board[pos.row][1] && !board[pos.row][2] && !board[pos.row][3] && board[pos.row][0]?.type === 'r' && !board[pos.row][0]?.hasMoved) {
            if (!this.isPositionUnderAttack({ row: pos.row, col: 2 }, piece.color, board) && !this.isPositionUnderAttack({ row: pos.row, col: 3 }, piece.color, board)) {
              moves.push({ row: pos.row, col: 2 });
            }
          }
        }
        break;
    }
    return moves;
  }

  getAllLegalMovesForPlayer(player: Player, board: Board): Move[] {
    const allMoves: Move[] = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (board[r][c]?.color === player) {
          const from = { row: r, col: c };
          const pseudoMoves = this.generatePseudoLegalMoves(from, board);
          pseudoMoves.forEach(to => {
            const tempBoard = this.simulateMove({ from, to }, board);
            if (!this.isKingInCheck(player, tempBoard)) {
              allMoves.push({ from, to });
            }
          });
        }
      }
    }
    return allMoves;
  }

  simulateMove(move: Move, board: Board): Board {
    const { from, to } = move;
    const newBoard = board.map(r => r.map(p => (p ? { ...p } : null)));
    const pieceToMove = newBoard[from.row][from.col];
    if (!pieceToMove) return newBoard;
    newBoard[to.row][to.col] = pieceToMove;
    newBoard[from.row][from.col] = null;
    if (pieceToMove.type === 'p' && from.col !== to.col && !board[to.row][to.col]) {
      newBoard[from.row][to.col] = null;
    }
    if (pieceToMove.type === 'k' && Math.abs(from.col - to.col) === 2) {
      const rookCol = to.col > from.col ? 7 : 0;
      const newRookCol = to.col > from.col ? 5 : 3;
      const rook = newBoard[from.row][rookCol];
      if (rook) {
        newBoard[from.row][newRookCol] = rook;
        newBoard[from.row][rookCol] = null;
      }
    }
    return newBoard;
  }

  isKingInCheck(player: Player, board: Board): boolean {
    const kingPos = this.findKing(player, board);
    return kingPos ? this.isPositionUnderAttack(kingPos, player, board) : true;
  }

  findKing(player: Player, board: Board): Position | null {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (board[r][c]?.type === 'k' && board[r][c]?.color === player) return { row: r, col: c };
      }
    }
    return null;
  }

  isPositionUnderAttack(pos: Position, attackedPlayer: Player, board: Board): boolean {
    const opponent: Player = attackedPlayer === 'w' ? 'b' : 'w';
    const { row, col } = pos;
    const pawnDir = attackedPlayer === 'w' ? -1 : 1;
    if (this.isValid(row + pawnDir, col - 1) && board[row + pawnDir][col - 1]?.type === 'p' && board[row + pawnDir][col - 1]?.color === opponent) return true;
    if (this.isValid(row + pawnDir, col + 1) && board[row + pawnDir][col + 1]?.type === 'p' && board[row + pawnDir][col + 1]?.color === opponent) return true;
    const knightMoves = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
    for (const [dr, dc] of knightMoves) {
        const r = row + dr; const c = col + dc;
        if (this.isValid(r, c) && board[r][c]?.type === 'n' && board[r][c]?.color === opponent) return true;
    }
    const slidingDirections = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
    for (const [dr, dc] of slidingDirections) {
        let r = row + dr; let c = col + dc;
        while (this.isValid(r, c)) {
            const piece = board[r][c];
            if (piece) {
                if (piece.color === opponent) {
                    const isRook = piece.type === 'r'; const isBishop = piece.type === 'b'; const isQueen = piece.type === 'q';
                    const isRookDirection = dr === 0 || dc === 0; const isBishopDirection = dr !== 0 && dc !== 0;
                    if (isQueen || (isRook && isRookDirection) || (isBishop && isBishopDirection)) return true;
                }
                break;
            }
            r += dr; c += dc;
        }
    }
    const kingMoves = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
    for (const [dr, dc] of kingMoves) {
        const r = row + dr; const c = col + dc;
        if (this.isValid(r, c) && board[r][c]?.type === 'k' && board[r][c]?.color === opponent) return true;
    }
    return false;
  }

  isValid(row: number, col: number): boolean {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
  }

  resetGame() {
    if (this.gameMode() === 'online') {
        if (confirm('Are you sure you want to resign?')) {
            this.matchmakingService.resignGame();
        }
        return;
    }
    this.board.set(this.createInitialBoard());
    this.currentPlayer.set('w');
    this.selectedSquare.set(null);
    this.legalMoves.set([]);
    this.gameState.set('playing');
    this.winner.set(null);
    this.promotionSquare.set(null);
    this.lastMove.set(null);
  }

  createInitialBoard(): Board {
    const board: Board = Array(8).fill(null).map(() => Array(8).fill(null));
    const place = (piece: Piece, row: number, col: number) => board[row][col] = piece;
    const backRank: PieceType[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
    for (let i = 0; i < 8; i++) {
      place({ type: 'p', color: 'b' }, 1, i);
      const blackPiece: Piece = { type: backRank[i], color: 'b', hasMoved: false };
      place(blackPiece, 0, i);
      place({ type: 'p', color: 'w' }, 6, i);
      const whitePiece: Piece = { type: backRank[i], color: 'w', hasMoved: false };
      place(whitePiece, 7, i);
    }
    return board;
  }

  // Drag and Drop handlers
  onDragStart(event: DragEvent, row: number, col: number): void {
    if (this.gameMode() === 'online' && !this.isMyTurn()) { event.preventDefault(); return; }
    const piece = this.board()[row][col];
    if (!piece || piece.color !== this.currentPlayer() || (this.gameState() !== 'playing' && this.gameState() !== 'check')) { event.preventDefault(); return; }
    this.draggedPiece.set({ row, col });
    this.handleSquareClick(row, col);
    if (event.dataTransfer) { event.dataTransfer.setData('text/plain', 'piece'); event.dataTransfer.effectAllowed = 'move'; }
  }

  onDragOver(event: DragEvent): void { event.preventDefault(); }
  onDrop(event: DragEvent, row: number, col: number): void { event.preventDefault(); this.handleSquareClick(row, col); this.draggedPiece.set(null); }
  onDragEnd(event: DragEvent): void { this.draggedPiece.set(null); this.selectedSquare.set(null); this.legalMoves.set([]); }

  // Touch event handlers
  onTouchStart(event: TouchEvent, row: number, col: number): void {
    if (this.gameMode() === 'online' && !this.isMyTurn()) return;
    if (this.gameState() === 'promotion' || this.gameState() === 'checkmate' || this.gameState() === 'stalemate') return;
    event.preventDefault();
    this.draggedPiece.set({ row, col });
    const touch = event.touches[0];
    this.touchStartCoords.set({ x: touch.clientX, y: touch.clientY });
    const boardEl = (event.currentTarget as HTMLElement).closest('.grid');
    if (boardEl instanceof HTMLElement) this.boardElement.set(boardEl);
  }

  onTouchMove(event: TouchEvent): void {
    if (!this.draggedPiece() || !this.touchStartCoords()) return;
    event.preventDefault();
    const touch = event.touches[0];
    const startCoords = this.touchStartCoords()!;
    const dx = touch.clientX - startCoords.x; const dy = touch.clientY - startCoords.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > 10 && !this.isTouchDragging()) {
      this.isTouchDragging.set(true);
      const startPos = this.draggedPiece()!;
      const piece = this.board()[startPos.row][startPos.col];
      if (piece && piece.color === this.currentPlayer() && (this.gameState() === 'playing' || this.gameState() === 'check')) {
          this.selectedSquare.set(startPos);
          this.calculateLegalMoves(startPos);
          this.floatingPiece.set({ piece, x: touch.clientX, y: touch.clientY });
      } else {
          this.cleanupTouchState(); return;
      }
    }
    if (this.isTouchDragging()) this.floatingPiece.update(fp => fp ? { ...fp, x: touch.clientX, y: touch.clientY } : null);
  }

  onTouchEnd(event: TouchEvent): void {
    const startPos = this.draggedPiece();
    if (!startPos) return;
    if (this.isTouchDragging()) {
        const touch = event.changedTouches[0];
        const boardEl = this.boardElement();
        if (!this.floatingPiece() || !boardEl || !touch) {
            if(this.selectedSquare()) { this.selectedSquare.set(null); this.legalMoves.set([]); }
            this.cleanupTouchState(); return;
        }
        const rect = boardEl.getBoundingClientRect();
        const x = touch.clientX - rect.left; const y = touch.clientY - rect.top;
        let moveMade = false;
        if (x >= 0 && x <= rect.width && y >= 0 && y <= rect.height) {
            const squareSize = rect.width / 8;
            const col = Math.floor(x / squareSize); const row = Math.floor(y / squareSize);
            if (this.isSquareLegalMove()(row, col)) { this.movePiece(startPos, { row, col }); moveMade = true; }
        }
        if (!moveMade) { this.selectedSquare.set(null); this.legalMoves.set([]); }
    } else {
        this.handleSquareClick(startPos.row, startPos.col);
    }
    this.cleanupTouchState();
  }

  private cleanupTouchState(): void {
    this.draggedPiece.set(null);
    this.floatingPiece.set(null);
    this.boardElement.set(null);
    this.isTouchDragging.set(false);
    this.touchStartCoords.set(null);
  }
}