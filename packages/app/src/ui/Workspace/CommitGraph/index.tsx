import { For, Show, createEffect, createSignal } from 'solid-js';
import { useInfiniteScroll } from 'solidjs-use';

import { statusToAlpha } from '@app/modules/git/diff';
import { GraphPoint } from '@app/modules/git/graph';
import { LogCommit } from '@app/modules/git/log';
import { PastCommit } from '@app/modules/git/show';
import { t } from '@app/modules/i18n';
import { relative } from '@app/modules/time';
import { createStoreListener } from '@stores/index';
import LocationStore from '@stores/location';
import RepositoryStore from '@stores/repository';
import * as Git from '@modules/git';

import EmptyState from '../../Common/EmptyState';
import Icon from '../../Common/Icon';
import Menu from '../../Menu';
import { showErrorModal } from '../../Modal';
import CommitDetailModal, { showCommitDetailModal } from './CommitDetailModal';

import './index.scss';

const clipboard = window.Native.DANGEROUS__NODE__REQUIRE('electron:clipboard');

const COLORS = ['blue', 'green', 'yellow', 'orange', 'red', 'indigo', 'violet'];
const COMMIT_LIMIT = 50;

export default () => {
	const repository = createStoreListener([LocationStore, RepositoryStore], () =>
		RepositoryStore.getById(LocationStore.selectedRepository?.id)
	);

	const selectedBranch = createStoreListener(
		[LocationStore],
		() => LocationStore.selectedHistoryBranch
	);

	const [commits, setCommits] = createSignal<LogCommit[]>([]);
	const [graph, setGraph] = createSignal<GraphPoint[]>([]);
	const [maxIndent, setMaxIndent] = createSignal(0);
	const [loading, setLoading] = createSignal(true);
	const [selectedCommit, setSelectedCommit] = createSignal<LogCommit | null>(null);
	const [commitFiles, setCommitFiles] = createSignal<PastCommit | null>(null);
	const [selectedHashes, setSelectedHashes] = createSignal<Set<string>>(new Set());
	const [listRef, setListRef] = createSignal<HTMLDivElement | null>(null);

	const branchToShow = () => selectedBranch() || repository()?.branch;

	createEffect(async () => {
		const repo = repository();
		const branch = branchToShow();
		if (!repo || !branch) return;

		setLoading(true);
		setSelectedCommit(null);
		setCommitFiles(null);
		setSelectedHashes(new Set<string>());

		try {
			const [logResult, graphResult] = await Promise.all([
				Git.Log(repo, COMMIT_LIMIT, undefined, branch),
				Git.Graph(repo)
			]);

			setCommits(logResult);
			const limited = graphResult.slice(0, logResult.length);
			setGraph(limited);
			setMaxIndent(Math.max(...limited.map((p) => p.indent), 0));
		} catch {
			setCommits([]);
			setGraph([]);
		}

		setLoading(false);
	});

	useInfiniteScroll(
		listRef,
		async () => {
			const repo = repository();
			const branch = branchToShow();
			if (!repo || !branch || commits().length === 0) return;

			const newItems = await Git.Log(
				repo,
				COMMIT_LIMIT,
				commits()[commits().length - 1],
				branch
			).catch(() => []);

			if (newItems.some((item) => commits().some((c) => c.hash === item.hash))) return;

			setCommits((prev) => prev.concat(newItems));
		},
		{ distance: 100 }
	);

	const getColor = (indent: number) =>
		`var(--color-${COLORS[indent % COLORS.length]}-500)`;

	const isMerge = (commit: LogCommit) => commit.parent?.includes(' ');

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

	return (
		<div class="commit-graph" classList={{ 'commit-graph--with-panel': !!selectedCommit() }}>
			{/* Main graph area */}
			<div class="commit-graph__main">
				<div class="commit-graph__header">
					<Icon name="git-branch" variant={16} />
					<span class="commit-graph__header__branch">{branchToShow()}</span>
					<span class="commit-graph__header__count">
						{commits().length} commits
					</span>
					<Show when={selectedHashes().size > 1}>
						<button
							class="commit-graph__header__action"
							onClick={copySelectedSHAs}
							title="Copy selected SHAs"
						>
							<Icon name="copy" variant={16} />
							{selectedHashes().size}
						</button>
					</Show>
				</div>
				<Show
					when={!loading()}
					fallback={<EmptyState spinner hint="Loading..." />}
				>
					<div class="commit-graph__list" ref={setListRef}>
						<For each={commits()}>
							{(commit) => {
								const point = () =>
									graph().find((p) => p?.hash === commit.hash);
								const indent = () => point()?.indent || 0;
								const color = () => getColor(indent());
								const merge = () => isMerge(commit);
								const isActive = () =>
									selectedCommit()?.hash === commit.hash;
								const isMultiSelected = () =>
									selectedHashes().has(commit.hash);

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
													isMultiSelected()
											}}
											onClick={(e) => {
												toggleHashSelection(commit.hash, e);
												selectCommit(commit);
											}}
										>
											{/* Rail */}
											<div
												class="commit-graph__rail"
												style={{
													width: `${(maxIndent() + 1) * 14 + 12}px`
												}}
											>
												<For
													each={Array.from({
														length: maxIndent() + 1
													})}
												>
													{(_, laneIdx) => (
														<div
															class="commit-graph__rail__lane"
															style={{
																left: `${laneIdx() * 14 + 6}px`,
																background: getColor(
																	laneIdx()
																)
															}}
														/>
													)}
												</For>
												<div
													classList={{
														'commit-graph__dot': true,
														'commit-graph__dot--merge':
															merge()
													}}
													style={{
														left: `${indent() * 14 + 2}px`,
														'border-color': color(),
														background: merge()
															? color()
															: 'var(--bg-primary)'
													}}
												/>
											</div>

											{/* Info */}
											<div class="commit-graph__info">
												<span class="commit-graph__info__message">
													{commit.message}
												</span>
												<Show when={point()?.refs}>
													<span
														class="commit-graph__info__ref"
														style={{
															color: color(),
															background: `color-mix(in srgb, ${color()} 12%, transparent 88%)`
														}}
													>
														{point()!.refs}
													</span>
												</Show>
											</div>

											{/* Meta */}
											<div class="commit-graph__meta">
												<span class="commit-graph__meta__hash">
													{commit.hash.substring(0, 7)}
												</span>
												<span class="commit-graph__meta__date">
													{relative(
														new Date(commit.date).getTime()
													)}
												</span>
											</div>
										</button>
									</Menu>
								);
							}}
						</For>
					</div>
				</Show>
			</div>

			{/* Right panel: changed files */}
			<Show when={selectedCommit()}>
				<div class="commit-graph__files">
					<div class="commit-graph__files__header">
						<div class="commit-graph__files__header__info">
							<span class="commit-graph__files__header__message">
								{selectedCommit()!.message}
							</span>
							<span class="commit-graph__files__header__hash">
								{selectedCommit()!.hash.substring(0, 7)}
							</span>
						</div>
						<button
							class="commit-graph__files__header__close"
							onClick={() => {
								setSelectedCommit(null);
								setCommitFiles(null);
							}}
						>
							<Icon name="x" variant={16} />
						</button>
					</div>
					<div class="commit-graph__files__list">
						<Show
							when={commitFiles()}
							fallback={<EmptyState spinner hint="Loading..." />}
						>
							<For each={commitFiles()!.files}>
								{(file) => (
									<div class="commit-graph__files__item">
										<div class="commit-graph__files__item__name">
											<Show when={file.path}>
												<span class="commit-graph__files__item__path">
													{file.path}/
												</span>
											</Show>
											{file.filename}
										</div>
										<div
											classList={{
												'commit-graph__files__item__status': true,
												[file.status]: true
											}}
										>
											{statusToAlpha(file.status)}
										</div>
									</div>
								)}
							</For>
						</Show>
					</div>
				</div>
			</Show>
		</div>
	);
};
