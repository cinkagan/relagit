import { createEffect, createSignal } from 'solid-js';
import { LogCommit } from '@app/modules/git/log';

export const ROW_HEIGHT = 34;
export const LANE_WIDTH = 20;

const DOT_RADIUS = 5;
const MERGE_DOT_RADIUS = 6;
const LINE_WIDTH = 2.5;

const COLORS = [
	'#06b6d4', // cyan / turquoise
	'#4fa3f7', // blue
	'#8b5cf6', // violet / purple
	'#e74c9e', // magenta / pink
	'#22c55e', // green
	'#f59e0b', // amber
	'#6366f1', // indigo
	'#ef4444', // red
	'#f97316' // orange
];

/** Deterministic color from a commit hash — stable across layout changes */
function hashColor(hash: string): string {
	let h = 0;
	for (let i = 0; i < hash.length; i++) {
		h = ((h << 5) - h + hash.charCodeAt(i)) | 0;
	}
	return COLORS[((h % COLORS.length) + COLORS.length) % COLORS.length];
}

// ─── Public interface for index.tsx ──────────────────────────────────────────

export interface LaneInfo {
	lane: number;
	parents: string[];
}

/**
 * Public API consumed by index.tsx for graphColumnWidth calculation.
 */
export const computeLanes = (commits: LogCommit[]): Map<string, LaneInfo> => {
	const graph = layoutGraph(commits);
	const out = new Map<string, LaneInfo>();
	for (const row of graph.rows) {
		out.set(row.hash, { lane: row.col, parents: row.parents });
	}
	return out;
};

// ─── Lane allocator types ───────────────────────────────────────────────────

interface ActiveLane {
	/** The commit hash this lane is waiting to encounter */
	expectedId: string;
	/** Stable color key (hash of the commit that opened this lane) */
	colorHash: string;
}

interface GraphRow {
	hash: string;
	row: number;
	col: number;
	parents: string[];
}

interface GraphEdge {
	fromRow: number;
	fromCol: number;
	toRow: number;
	toCol: number;
	colorHash: string;
}

interface PassThrough {
	row: number;
	col: number;
	colorHash: string;
}

interface GraphLayout {
	rows: GraphRow[];
	edges: GraphEdge[];
	passThrough: PassThrough[];
	maxCol: number;
}

// ─── Core layout algorithm ──────────────────────────────────────────────────

/**
 * Compact active-lane git graph layout.
 *
 * The algorithm maintains an ordered array of ActiveLane entries.
 * Each entry tracks the next expected commit hash for that visual column.
 * Lanes are created when branches diverge and destroyed when they converge
 * or become unreachable. After every row the array is compacted to remove
 * gaps, so column indices are always 0..N-1.
 *
 * Critical optimization: before starting, we precompute which commit hashes
 * exist in the visible set. Any lane expecting a hash that will never appear
 * is killed immediately — this prevents off-screen parents from holding
 * lanes open forever.
 */
function layoutGraph(commits: LogCommit[]): GraphLayout {
	if (commits.length === 0) {
		return { rows: [], edges: [], passThrough: [], maxCol: 0 };
	}

	// ── Precompute: set of all visible hashes + hash→row lookup ──
	const visibleSet = new Set<string>();
	const hashToRow = new Map<string, number>();
	for (let i = 0; i < commits.length; i++) {
		visibleSet.add(commits[i].hash);
		hashToRow.set(commits[i].hash, i);
	}

	// For aggressive cleanup: at each row index, which hashes are still
	// remaining below (inclusive). We build a suffix set.
	// remainingBelow[i] = set of hashes at index >= i
	// For memory efficiency we just use the full visibleSet and remove
	// hashes as we process them.
	const remaining = new Set(visibleSet);

	const graphRows: GraphRow[] = [];
	const edges: GraphEdge[] = [];
	const passThrough: PassThrough[] = [];
	let maxCol = 0;

	// Active lanes — dense array, no nulls.
	const lanes: ActiveLane[] = [];

	for (let i = 0; i < commits.length; i++) {
		const commit = commits[i];
		const hash = commit.hash;
		const parentStr = commit.parent?.trim() || '';
		const parents = parentStr ? parentStr.split(' ').filter(Boolean) : [];

		// Remove this commit from remaining (it's being processed now)
		remaining.delete(hash);

		// ── A. Find lane for this commit ──

		let col = -1;
		for (let l = 0; l < lanes.length; l++) {
			if (lanes[l].expectedId === hash) {
				col = l;
				break;
			}
		}

		// Collapse any ADDITIONAL lanes also expecting this hash
		// (convergent branches pointing to the same parent).
		// Keep leftmost (col), remove all others.
		if (col !== -1) {
			for (let l = lanes.length - 1; l >= 0; l--) {
				if (l !== col && lanes[l].expectedId === hash) {
					lanes.splice(l, 1);
					if (l < col) col--;
				}
			}
		}

		if (col === -1) {
			// New branch head — append at end
			col = lanes.length;
			lanes.push({ expectedId: hash, colorHash: hash });
		}

		// ── B. Record this row's position ──

		graphRows.push({ hash, row: i, col, parents });
		if (col > maxCol) maxCol = col;

		// ── B2. Record pass-through lines for OTHER lanes at this row ──

		for (let l = 0; l < lanes.length; l++) {
			if (l !== col) {
				passThrough.push({ row: i, col: l, colorHash: lanes[l].colorHash });
			}
		}

		// ── C. Update lanes for this commit's parents ──

		if (parents.length === 0) {
			// Root commit — kill this lane
			lanes.splice(col, 1);
		} else {
			const firstParent = parents[0];

			// Check if first parent is already expected by another lane
			let fpLane = -1;
			for (let l = 0; l < lanes.length; l++) {
				if (l !== col && lanes[l].expectedId === firstParent) {
					fpLane = l;
					break;
				}
			}

			if (fpLane !== -1) {
				// First parent already tracked — this lane merges into it; kill this lane
				lanes.splice(col, 1);
			} else {
				// Continue this lane with the first parent
				lanes[col] = { expectedId: firstParent, colorHash: lanes[col].colorHash };
			}

			// Secondary (merge) parents — create temporary lanes only if needed
			for (let p = 1; p < parents.length; p++) {
				const ph = parents[p];

				// Skip if already tracked by an existing lane
				let alreadyTracked = false;
				for (let l = 0; l < lanes.length; l++) {
					if (lanes[l].expectedId === ph) {
						alreadyTracked = true;
						break;
					}
				}

				if (!alreadyTracked) {
					// Only create lane if this parent actually appears in visible commits
					if (remaining.has(ph) || visibleSet.has(ph)) {
						// Insert adjacent to current col for short merge curves.
						// After splice above, col may have been removed, so find
						// where first parent lives now.
						let insertAt = lanes.length; // default: end
						for (let l = 0; l < lanes.length; l++) {
							if (lanes[l].expectedId === firstParent) {
								insertAt = l + 1;
								break;
							}
						}
						insertAt = Math.min(insertAt, lanes.length);
						lanes.splice(insertAt, 0, { expectedId: ph, colorHash: ph });
					}
				}
			}
		}

		// ── D. Aggressive cleanup: kill lanes expecting hashes that ──
		// ──    will never appear in remaining visible commits         ──

		for (let l = lanes.length - 1; l >= 0; l--) {
			if (!remaining.has(lanes[l].expectedId)) {
				lanes.splice(l, 1);
			}
		}

		// After cleanup, update maxCol
		if (lanes.length - 1 > maxCol) maxCol = lanes.length - 1;
	}

	// ── Build edges ──

	// Create a fast lookup from hash to GraphRow
	const rowByHash = new Map<string, GraphRow>();
	for (const r of graphRows) {
		rowByHash.set(r.hash, r);
	}

	for (const row of graphRows) {
		for (const parentHash of row.parents) {
			const parentRow = rowByHash.get(parentHash);
			if (!parentRow) continue;

			edges.push({
				fromRow: row.row,
				fromCol: row.col,
				toRow: parentRow.row,
				toCol: parentRow.col,
				colorHash: row.hash
			});
		}
	}

	return { rows: graphRows, edges, passThrough, maxCol };
}

// ─── Canvas renderer ────────────────────────────────────────────────────────

export interface GraphCanvasProps {
	commits: LogCommit[];
	scrollTop: number;
	containerHeight: number;
}

export default (props: GraphCanvasProps) => {
	const [canvas, setCanvas] = createSignal<HTMLCanvasElement | null>(null);

	const graph = () => layoutGraph(props.commits);

	const canvasWidth = () => (graph().maxCol + 1) * LANE_WIDTH + 16;
	const canvasHeight = () => props.commits.length * ROW_HEIGHT;

	const getX = (col: number) => col * LANE_WIDTH + LANE_WIDTH / 2 + 4;
	const getY = (row: number) => row * ROW_HEIGHT + ROW_HEIGHT / 2;

	createEffect(() => {
		const el = canvas();
		if (!el) return;

		const g = graph();
		const width = canvasWidth();
		const height = canvasHeight();
		const dpr = window.devicePixelRatio || 1;

		el.width = width * dpr;
		el.height = height * dpr;
		el.style.width = `${width}px`;
		el.style.height = `${height}px`;

		const ctx = el.getContext('2d');
		if (!ctx) return;

		const bgColor =
			getComputedStyle(el).getPropertyValue('--bg-primary').trim() || '#1a1b1e';

		ctx.scale(dpr, dpr);
		ctx.clearRect(0, 0, width, height);
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';

		const visibleStart = Math.max(0, Math.floor(props.scrollTop / ROW_HEIGHT) - 5);
		const visibleEnd = Math.min(
			props.commits.length,
			Math.ceil((props.scrollTop + props.containerHeight) / ROW_HEIGHT) + 5
		);

		// ── Pass-through vertical lines ──
		ctx.lineWidth = LINE_WIDTH;
		ctx.globalAlpha = 0.5;
		for (const pt of g.passThrough) {
			if (pt.row < visibleStart || pt.row > visibleEnd) continue;

			const x = getX(pt.col);
			ctx.strokeStyle = hashColor(pt.colorHash);
			ctx.beginPath();
			ctx.moveTo(x, getY(pt.row) - ROW_HEIGHT / 2);
			ctx.lineTo(x, getY(pt.row) + ROW_HEIGHT / 2);
			ctx.stroke();
		}

		// ── Edges ──
		ctx.lineWidth = LINE_WIDTH;
		ctx.globalAlpha = 0.85;
		for (const edge of g.edges) {
			if (
				(edge.fromRow < visibleStart - 2 && edge.toRow < visibleStart - 2) ||
				(edge.fromRow > visibleEnd + 2 && edge.toRow > visibleEnd + 2)
			) {
				continue;
			}

			const x1 = getX(edge.fromCol);
			const y1 = getY(edge.fromRow);
			const x2 = getX(edge.toCol);
			const y2 = getY(edge.toRow);

			ctx.strokeStyle = hashColor(edge.colorHash);
			ctx.beginPath();

			if (edge.fromCol === edge.toCol) {
				ctx.moveTo(x1, y1);
				ctx.lineTo(x2, y2);
			} else {
				// Smooth bezier — curve radius proportional to vertical distance
				const dy = Math.abs(y2 - y1);
				const curve = Math.min(ROW_HEIGHT, dy * 0.4);
				ctx.moveTo(x1, y1);
				ctx.bezierCurveTo(x1, y1 + curve, x2, y2 - curve, x2, y2);
			}
			ctx.stroke();
		}

		// ── Commit dots ──
		ctx.globalAlpha = 1;
		for (const row of g.rows) {
			if (row.row < visibleStart || row.row > visibleEnd) continue;

			const x = getX(row.col);
			const y = getY(row.row);
			const color = hashColor(row.hash);
			const isMerge = row.parents.length > 1;

			if (isMerge) {
				ctx.beginPath();
				ctx.arc(x, y, MERGE_DOT_RADIUS, 0, Math.PI * 2);
				ctx.fillStyle = color;
				ctx.fill();
			} else {
				ctx.beginPath();
				ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
				ctx.fillStyle = bgColor;
				ctx.fill();
				ctx.strokeStyle = color;
				ctx.lineWidth = 2.5;
				ctx.stroke();
				ctx.lineWidth = LINE_WIDTH; // restore for next edge
			}
		}
	});

	return (
		<canvas
			ref={setCanvas}
			class="commit-graph__canvas"
			style={{
				width: `${canvasWidth()}px`,
				height: `${canvasHeight()}px`
			}}
		/>
	);
};
