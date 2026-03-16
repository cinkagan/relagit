import { For, Show, createEffect, createSignal } from 'solid-js';
import { useInfiniteScroll } from 'solidjs-use';

import { statusToAlpha } from '@app/modules/git/diff';
import { LogCommit } from '@app/modules/git/log';
import { PastCommit } from '@app/modules/git/show';
import { t } from '@app/modules/i18n';
import { createStoreListener } from '@stores/index';
import FileStore from '@stores/files';
import LocationStore from '@stores/location';
import RepositoryStore from '@stores/repository';
import * as Git from '@modules/git';

import EmptyState from '../../Common/EmptyState';
import Icon from '../../Common/Icon';
import Menu from '../../Menu';
import { showErrorModal } from '../../Modal';
import CommitDetailModal, { showCommitDetailModal } from './CommitDetailModal';
import GraphCanvas, { computeLanes, ROW_HEIGHT, LANE_WIDTH } from './GraphCanvas';

import './index.scss';

const clipboard = window.Native.DANGEROUS__NODE__REQUIRE('electron:clipboard');

const COMMIT_LIMIT = 50;
const BRANCH_COL_WIDTH = 260;

/** Extract branch/tag names from a refs string like "HEAD -> develop, origin/develop, tag: v1.0" */
const extractBranchesFromRefs = (refs: string): string[] => {
	if (!refs || !refs.trim()) return [];
	return refs
		.replace(/\(|\)/g, '')
		.split(',')
		.map((r) => r.trim())
		.filter((r) => r && !r.startsWith('tag:'))
		.map((r) => {
			if (r.includes('->')) return r.split('->')[1].trim();
			return r;
		})
		.filter(Boolean);
};

/** Extract tags from refs string */
const extractTagsFromRefs = (refs: string): string[] => {
	if (!refs || !refs.trim()) return [];
	return refs
		.replace(/\(|\)/g, '')
		.split(',')
		.map((r) => r.trim())
		.filter((r) => r.startsWith('tag:'))
		.map((r) => r.replace(/^tag:\s*/, ''));
};

/** Get a short display name for a branch ref */
const shortBranchName = (ref: string): string => {
	// Remove origin/ prefix for display
	return ref.replace(/^origin\//, '');
};

/** Deduplicate branch names (local + origin same branch) */
const deduplicateBranches = (branches: string[]): string[] => {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const b of branches) {
		const short = shortBranchName(b);
		if (!seen.has(short)) {
			seen.add(short);
			result.push(b);
		}
	}
	return result;
};

export interface CommitGraphProps {
	onBranchesFound?: (branches: string[]) => void;
	highlightBranch?: string | null;
}

export default (props: CommitGraphProps) => {
	const repository = createStoreListener([LocationStore, RepositoryStore], () =>
		RepositoryStore.getById(LocationStore.selectedRepository?.id)
	);

	const [commits, setCommits] = createSignal<LogCommit[]>([]);
	const [loading, setLoading] = createSignal(true);
	const [selectedCommit, setSelectedCommit] = createSignal<LogCommit | null>(null);
	const [commitFiles, setCommitFiles] = createSignal<PastCommit | null>(null);
	const [selectedHashes, setSelectedHashes] = createSignal<Set<string>>(new Set());
	const [listRef, setListRef] = createSignal<HTMLDivElement | null>(null);
	const [highlightedHashes, setHighlightedHashes] = createSignal<Set<string>>(new Set());
	const [scrollTop, setScrollTop] = createSignal(0);
	const [containerHeight, setContainerHeight] = createSignal(600);
	const branchToShow = () => repository()?.branch;

	// Stable key that only changes when the actual repo+branch identity changes,
	// not on every store emit (ahead/behind updates, etc.)
	const [loadKey, setLoadKey] = createSignal('');
	createEffect(() => {
		const repo = repository();
		const key = `${repo?.id || ''}::${repo?.branch || ''}`;
		setLoadKey(key);
	});

	// Track uncommitted changes for WIP row
	const changedFiles = createStoreListener([FileStore, LocationStore], () => {
		const repo = repository();
		if (!repo) return [];
		return FileStore.getByRepositoryPath(repo.path) || [];
	});
	const hasWip = () => (changedFiles() || []).length > 0;

	const graphColumnWidth = () => {
		const lanes = computeLanes(commits());
		let max = 0;
		for (const info of lanes.values()) {
			if (info.lane > max) max = info.lane;
		}
		return (max + 1) * LANE_WIDTH + 16;
	};

	// When highlightBranch changes, fetch that branch's log hashes
	createEffect(async () => {
		const branch = props.highlightBranch;
		const repo = repository();

		if (!branch || !repo) {
			setHighlightedHashes(new Set<string>());
			return;
		}

		try {
			const branchLog = await Git.Log(repo, 200, undefined, branch);
			setHighlightedHashes(new Set(branchLog.map((c) => c.hash)));
		} catch {
			setHighlightedHashes(new Set<string>());
		}
	});

	createEffect(async () => {
		const key = loadKey(); // only reactive dependency
		if (!key) return;

		// Read repo/branch non-reactively from the current store snapshot
		const repo = RepositoryStore.getById(LocationStore.selectedRepository?.id);
		const branch = repo?.branch;
		if (!repo || !branch) return;

		setLoading(true);
		setSelectedCommit(null);
		setCommitFiles(null);
		setSelectedHashes(new Set<string>());

		try {
			const db = await Git.DefaultBranch(repo);
			let logBranch: string = branch;

			if (branch !== db) {
				const mergeBase = await Git.MergeBase(repo, db, branch);
				if (mergeBase) {
					logBranch = `${mergeBase}..${branch}`;
				}
			}

			const logResult = await Git.Log(repo, COMMIT_LIMIT, undefined, logBranch);

			setCommits(logResult);

			const branchSet = new Set<string>();
			for (const commit of logResult) {
				if (commit.refs) {
					for (const b of extractBranchesFromRefs(commit.refs)) {
						branchSet.add(b);
					}
				}
			}
			props.onBranchesFound?.(Array.from(branchSet).sort());
		} catch {
			setCommits([]);
			props.onBranchesFound?.([]);
		}

		setLoading(false);
	});

	useInfiniteScroll(
		listRef,
		async () => {
			const repo = repository();
			const branch = branchToShow();
			if (!repo || !branch || commits().length === 0) return;

			const db = await Git.DefaultBranch(repo);
			let logBranch: string = branch;
			if (branch !== db) {
				const mergeBase = await Git.MergeBase(repo, db, branch);
				if (mergeBase) {
					logBranch = `${mergeBase}..${branch}`;
				}
			}

			const newItems = await Git.Log(
				repo,
				COMMIT_LIMIT,
				commits()[commits().length - 1],
				logBranch
			).catch(() => []);

			if (newItems.some((item) => commits().some((c) => c.hash === item.hash))) return;

			const updated = [...commits(), ...newItems];
			setCommits(updated);

			if (props.onBranchesFound) {
				const branchSet = new Set<string>();
				for (const commit of updated) {
					if (commit.refs) {
						for (const b of extractBranchesFromRefs(commit.refs)) {
							branchSet.add(b);
						}
					}
				}
				props.onBranchesFound(Array.from(branchSet).sort());
			}
		},
		{ distance: 100 }
	);

	const selectCommit = async (commit: LogCommit) => {
		setSelectedCommit(commit);
		setCommitFiles(null);

		try {
			const result = await Git.Show(repository()?.path, commit.hash);
			setCommitFiles(result || null);
		} catch (e) {
			showErrorModal(e, 'error.git');
		}
	};

	const toggleHashSelection = (hash: string, e: MouseEvent) => {
		if (e.metaKey || e.ctrlKey) {
			setSelectedHashes((prev) => {
				const next = new Set(prev);
				if (next.has(hash)) {
					next.delete(hash);
				} else {
					next.add(hash);
				}
				return next;
			});
		} else {
			setSelectedHashes(new Set([hash]));
		}
	};

	const copySelectedSHAs = () => {
		const hashes = Array.from(selectedHashes());
		if (hashes.length > 0) {
			clipboard.writeText(hashes.join('\n'));
		}
	};

	const cherryPickSelected = async () => {
		const hashes = Array.from(selectedHashes());
		if (hashes.length === 0) return;

		try {
			for (const hash of hashes) {
				await Git.CherryPick(repository()!, { hash } as LogCommit);
			}
			const { refetchRepository } = await import('@app/modules/actions');
			await refetchRepository(LocationStore.selectedRepository);
		} catch (e) {
			showErrorModal(e, 'error.git');
		}
	};

	const handleScroll = (e: Event) => {
		const el = e.target as HTMLDivElement;
		setScrollTop(el.scrollTop);
		setContainerHeight(el.clientHeight);
	};

	createEffect(() => {
		const el = listRef();
		if (el) {
			setContainerHeight(el.clientHeight);
		}
	});

	return (
		<div class="commit-graph" classList={{ 'commit-graph--with-panel': !!selectedCommit() }}>
			<div class="commit-graph__main">
				{/* Column headers */}
				<div class="commit-graph__columns">
					<div
						class="commit-graph__columns__branch"
						style={{ width: `${BRANCH_COL_WIDTH}px` }}
					>
						{t('git.commitGraph.branchTag') || 'BRANCH / TAG'}
					</div>
					<div
						class="commit-graph__columns__graph"
						style={{ width: `${graphColumnWidth()}px` }}
					>
						{t('git.commitGraph.graph') || 'GRAPH'}
					</div>
					<div class="commit-graph__columns__message">
						{t('git.commitGraph.commitMessage') || 'COMMIT MESSAGE'}
					</div>
				</div>
					<div
					class="commit-graph__list"
					ref={setListRef}
					onScroll={handleScroll}
				>
					<Show when={loading()}>
						<div class="commit-graph__loading-overlay">
							<div class="commit-graph__loading-bar" />
						</div>
					</Show>
						{/* Canvas graph overlay — offset by branch column, shifted down for WIP row */}
						<div
							class="commit-graph__canvas-container"
							style={{
								left: `${BRANCH_COL_WIDTH}px`,
								top: hasWip() ? `${ROW_HEIGHT}px` : '0',
								width: `${graphColumnWidth()}px`,
								height: `${commits().length * ROW_HEIGHT}px`
							}}
						>
							<GraphCanvas
								commits={commits()}
								scrollTop={Math.max(0, scrollTop() - (hasWip() ? ROW_HEIGHT : 0))}
								containerHeight={containerHeight()}
							/>
						</div>

						{/* Commit rows */}
						<div class="commit-graph__rows">
							{/* WIP row — shows uncommitted changes at the top */}
							<Show when={hasWip()}>
								<div class="commit-graph__row commit-graph__row--wip">
									<div
										class="commit-graph__row__branch"
										style={{ width: `${BRANCH_COL_WIDTH}px` }}
									/>
									<div
										class="commit-graph__row__spacer"
										style={{ width: `${graphColumnWidth()}px` }}
									/>
									<div class="commit-graph__info">
										<span class="commit-graph__info__wip-input">// WIP</span>
										<span class="commit-graph__info__wip-stats">
											<Icon name="pencil" variant={16} size={12} />
											{(changedFiles() || []).length}
										</span>
									</div>
								</div>
							</Show>

							<For each={commits()}>
								{(commit) => {
									const isActive = () =>
										selectedCommit()?.hash === commit.hash;
									const isMultiSelected = () =>
										selectedHashes().has(commit.hash);
									const isHighlighted = () =>
										highlightedHashes().size > 0 &&
										highlightedHashes().has(commit.hash);
									const isDimmed = () =>
										highlightedHashes().size > 0 &&
										!highlightedHashes().has(commit.hash);

									const branches = () =>
										deduplicateBranches(
											extractBranchesFromRefs(commit.refs || '')
										);
									const tags = () =>
										extractTagsFromRefs(commit.refs || '');
									const currentBranch = () =>
										repository()?.branch;
									const isMerge = () =>
										(commit.parent?.trim().split(' ').length || 0) > 1;

									return (
										<Menu
											interfaceId="commit-graph-item"
											items={[
												{
													type: 'item',
													label: t('git.commitGraph.viewDetails'),
													onClick: () => {
														showCommitDetailModal(
															repository()!,
															commit
														);
													}
												},
												{
													type: 'item',
													label: t('git.commitGraph.cherryPick'),
													onClick: async () => {
														try {
															await Git.CherryPick(
																repository()!,
																commit
															);
															const { refetchRepository } =
																await import(
																	'@app/modules/actions'
																);
															await refetchRepository(
																LocationStore.selectedRepository
															);
														} catch (e) {
															showErrorModal(e, 'error.git');
														}
													}
												},
												{
													type: 'separator'
												},
												{
													type: 'item',
													label: t('sidebar.contextMenu.copySha'),
													onClick: () => {
														if (selectedHashes().size > 1) {
															copySelectedSHAs();
														} else {
															clipboard.writeText(commit.hash);
														}
													}
												},
												...(selectedHashes().size > 1
													? [
															{
																type: 'separator' as const
															},
															{
																type: 'item' as const,
																label: t(
																	'git.commitGraph.cherryPickSelected',
																	{
																		count: String(
																			selectedHashes().size
																		)
																	}
																),
																onClick: cherryPickSelected
															},
															{
																type: 'item' as const,
																label: t(
																	'git.commitGraph.copySelectedSha',
																	{
																		count: String(
																			selectedHashes().size
																		)
																	}
																),
																onClick: copySelectedSHAs
															}
														]
													: [])
											]}
										>
											<button
												classList={{
													'commit-graph__row': true,
													'commit-graph__row--active': isActive(),
													'commit-graph__row--selected':
														isMultiSelected(),
													'commit-graph__row--highlighted':
														isHighlighted(),
													'commit-graph__row--dimmed':
														isDimmed()
												}}
												onClick={(e) => {
													toggleHashSelection(commit.hash, e);
													selectCommit(commit);
												}}
											>
												{/* Branch / Tag column */}
												<div
													class="commit-graph__row__branch"
													style={{
														width: `${BRANCH_COL_WIDTH}px`
													}}
												>
													<For each={branches()}>
														{(ref) => {
															const isCurrentBranch =
																shortBranchName(ref) ===
																currentBranch();
															const isRemote =
																ref.startsWith('origin/');
															const hasLocalAndRemote = () =>
																branches().some(
																	(b) =>
																		b !== ref &&
																		shortBranchName(b) ===
																			shortBranchName(ref)
																);
															return (
																<span
																	classList={{
																		'commit-graph__branch-badge': true,
																		'commit-graph__branch-badge--current':
																			isCurrentBranch
																	}}
																>
																	<Show when={isCurrentBranch}>
																		<Icon
																			name="check"
																			variant={16}
																			size={12}
																		/>
																	</Show>
																	<span class="commit-graph__branch-badge__name">
																		{shortBranchName(ref)}
																	</span>
																	<span class="commit-graph__branch-badge__icons">
																		<Show when={!isRemote}>
																			<Icon
																				name="device-desktop"
																				variant={16}
																			/>
																		</Show>
																		<Show when={isRemote || hasLocalAndRemote()}>
																			<Icon
																				name="globe"
																				variant={16}
																			/>
																		</Show>
																	</span>
																</span>
															);
														}}
													</For>
													<For each={tags()}>
														{(tag) => (
															<span class="commit-graph__tag-badge">
																<Icon
																	name="tag"
																	variant={16}
																	size={12}
																/>
																{tag}
															</span>
														)}
													</For>
													<Show
														when={
															branches().some(
																(b) =>
																	shortBranchName(b) ===
																	currentBranch()
															) && (repository()?.ahead || 0) > 0
														}
													>
														<span class="commit-graph__ahead-badge">
															+{repository()?.ahead}
														</span>
													</Show>
												</div>

												{/* Graph spacer */}
												<div
													class="commit-graph__row__spacer"
													style={{
														width: `${graphColumnWidth()}px`
													}}
												/>

												{/* Commit message */}
												<div class="commit-graph__info">
													<span
														classList={{
															'commit-graph__info__message': true,
															'commit-graph__info__message--merge':
																isMerge()
														}}
													>
														{commit.message}
													</span>
												</div>
											</button>
										</Menu>
									);
								}}
							</For>
						</div>
					</div>
			</div>

			{/* Right panel: commit details + changed files */}
			<Show when={selectedCommit()}>
				<div class="commit-graph__detail">
					{/* Header: commit message + close */}
					<div class="commit-graph__detail__header">
						<div class="commit-graph__detail__header__title">
							{selectedCommit()!.message}
						</div>
						<button
							class="commit-graph__detail__header__close"
							onClick={() => {
								setSelectedCommit(null);
								setCommitFiles(null);
							}}
						>
							<Icon name="x" variant={16} />
						</button>
					</div>

					{/* Meta: SHA, author, date, parent */}
					<div class="commit-graph__detail__meta">
						<div class="commit-graph__detail__meta__row">
							<span class="commit-graph__detail__meta__label">
								<Icon name="git-commit" variant={16} />
							</span>
							<button
								class="commit-graph__detail__meta__sha"
								onClick={() => clipboard.writeText(selectedCommit()!.hash)}
								title="Copy full SHA"
							>
								{selectedCommit()!.hash.substring(0, 10)}
								<Icon name="copy" variant={16} />
							</button>
						</div>
						<div class="commit-graph__detail__meta__row">
							<span class="commit-graph__detail__meta__label">
								<Icon name="person" variant={16} />
							</span>
							<span class="commit-graph__detail__meta__value">
								{selectedCommit()!.author}
							</span>
						</div>
						<div class="commit-graph__detail__meta__row">
							<span class="commit-graph__detail__meta__label">
								<Icon name="clock" variant={16} />
							</span>
							<span class="commit-graph__detail__meta__value">
								{new Date(selectedCommit()!.date).toLocaleString()}
							</span>
						</div>
						<Show when={selectedCommit()!.parent}>
							<div class="commit-graph__detail__meta__row">
								<span class="commit-graph__detail__meta__label">
									<Icon name="git-branch" variant={16} />
								</span>
								<span class="commit-graph__detail__meta__value commit-graph__detail__meta__value--mono">
									{selectedCommit()!.parent?.split(' ').map((p) => p.substring(0, 7)).join(' ')}
								</span>
							</div>
						</Show>
					</div>

					{/* Stats bar */}
					<Show when={commitFiles()}>
						<div class="commit-graph__detail__stats">
							<span class="commit-graph__detail__stats__item">
								<Icon name="file" variant={16} />
								{commitFiles()!.files.length}
							</span>
							<span class="commit-graph__detail__stats__item commit-graph__detail__stats__item--added">
								+{selectedCommit()!.insertions}
							</span>
							<span class="commit-graph__detail__stats__item commit-graph__detail__stats__item--deleted">
								-{selectedCommit()!.deletions}
							</span>
						</div>
					</Show>

					{/* Changed files list */}
					<div class="commit-graph__detail__files">
						<Show
							when={commitFiles()}
							fallback={
								<div class="commit-graph__detail__files__loading">
									<div class="commit-graph__loading-bar" />
								</div>
							}
						>
							<div class="commit-graph__detail__files__list">
								<For each={commitFiles()!.files}>
									{(file) => (
										<div class="commit-graph__detail__files__item">
											<div
												classList={{
													'commit-graph__detail__files__item__indicator': true,
													[file.status]: true
												}}
											/>
											<div class="commit-graph__detail__files__item__name">
												<Show when={file.path}>
													<span class="commit-graph__detail__files__item__path">
														{file.path}/
													</span>
												</Show>
												{file.filename}
											</div>
											<div
												classList={{
													'commit-graph__detail__files__item__status': true,
													[file.status]: true
												}}
											>
												{statusToAlpha(file.status)}
											</div>
										</div>
									)}
								</For>
							</div>
						</Show>
					</div>
				</div>
			</Show>
		</div>
	);
};
