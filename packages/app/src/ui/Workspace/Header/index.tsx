import { For, JSX, Show, createEffect, createMemo, createRoot, createSignal } from 'solid-js';

import { Branch } from '@app/modules/git/branches';
import { StashEntry } from '@app/modules/git/stash';
import { t } from '@app/modules/i18n';
import { Reffable } from '@app/shared';
import DraftStore from '@app/stores/draft';
import OnboardingStore from '@app/stores/onboarding';
import RemoteStore from '@app/stores/remote';
import RepositoryStore, { Repository } from '@app/stores/repository';
import SettingsStore from '@app/stores/settings';
import FileStore, { GitFile } from '@app/stores/files';
import AffinityStore from '@app/stores/affinity';
import Popout from '@app/ui/Common/Popout';
import Menu from '@app/ui/Menu';
import { showErrorModal } from '@app/ui/Modal';
import ModalStore from '@app/stores/modal';
import { refetchRepository, removeRepository, triggerWorkflow } from '@modules/actions';
import * as Git from '@modules/git';
import { debug, error } from '@modules/logger';
import { renderDate } from '@modules/time';
import { createStoreListener } from '@stores/index';
import LocationStore from '@stores/location';
import { branchFormatsForProvider } from '~/app/src/modules/github';
import { openExternal, showItemInFolder } from '~/app/src/modules/shell';
import { openInEditor } from '@app/modules/editor';

import Icon, { IconName } from '@ui/Common/Icon';
import Tooltip from '@ui/Common/Tooltip';
import { showCherryPickModal } from '@ui/Modal/CherryPick';
import { showConflictModal } from '@ui/Modal/Conflict';
import { showPublishModal } from '@ui/Modal/Publish';
import { showSequentialMergeModal } from '@ui/Modal/SequentialMerge';
import CloneModal from '@ui/Modal/CloneModal';
import { showRepoModal } from '@ui/Modal/RepositoryModal';
import TextArea from '../../Common/TextArea';

import './index.scss';

export interface PanelButtonProps {
	id: string;
	icon: IconName;
	iconVariant?: 12 | 16 | 24;
	name?: string;
	onClick?: (e: MouseEvent | KeyboardEvent) => void;
	onMouseDown?: (e: MouseEvent | KeyboardEvent) => void;
	size?: 'small' | 'medium' | 'large';
	label?: string;
	detail?: JSX.Element | string;
	tooltip?: string;
	tooltipPosition?: 'top' | 'bottom' | 'auto';
	disabled?: boolean;
	className?: string;
	loading?: boolean;
}

const PanelButton = (props: Reffable<PanelButtonProps>) => {
	return (
		<Tooltip text={props.tooltip || ''} position={props.tooltipPosition || 'auto'}>
			{(p) => {
				return (
					<button
						{...p}
						ref={props.ref}
						role="button"
						aria-label={props.label || props.name}
						aria-selected={props.className?.includes('active')}
						disabled={props.loading || props.disabled}
						classList={{
							workspace__header__panelbutton: true,
							'workspace__header__panelbutton-small': props.size === 'small',
							'workspace__header__panelbutton-medium': props.size === 'medium',
							'workspace__header__panelbutton-large': props.size === 'large',
							disabled: props.disabled || props.loading,
							[props.className!]: true
						}}
						onClick={props.onClick}
						onMouseDown={props.onMouseDown}
						onKeyDown={(e) => {
							if (e.key === 'Enter') {
								if (props.onClick) props.onClick(e);
								if (props.onMouseDown) props.onMouseDown(e);
							}
						}}
						id={props.id}
					>
						<Icon name={props.icon} variant={props.iconVariant} />
						<Show when={props.label || props.detail}>
							<div class="workspace__header__panelbutton__info">
								{props.label && (
									<div class="workspace__header__panelbutton__info__label">
										{props.label}
									</div>
								)}
								{props.detail && (
									<div class="workspace__header__panelbutton__info__detail">
										{props.detail}
									</div>
								)}
							</div>
						</Show>
						<Show when={props.loading}>
							<div class="workspace__header__panelbutton__loading"></div>
						</Show>
					</button>
				);
			}}
		</Tooltip>
	);
};

const hasUncommittedChanges = (files: Map<string, GitFile[]>, repository: Repository) => {
	const changes = files.get(repository.path);
	if (!changes) return false;
	return changes.length > 0;
};

export default () => {
	const repository = createStoreListener([LocationStore, RepositoryStore], () =>
		RepositoryStore.getById(LocationStore.selectedRepository?.id)
	);
	const [hasNewBranchInput, setHasNewBranchInput] = createSignal(false);
	const [newBranch, setNewBranch] = createSignal('');
	const [inputRef, setInputRef] = createSignal<HTMLElement>();
	const [branches, setBranches] = createSignal<Branch[] | null>(null);
	const [branchSearch, setBranchSearch] = createSignal('');

	const filteredBranches = () => {
		const search = branchSearch().toLowerCase().trim();
		if (!search) return branches();
		const filtered = branches()?.filter((b) =>
			b.gitName.toLowerCase().includes(search) || b.name.toLowerCase().includes(search)
		);
		if (!filtered) return null;
		return filtered.sort((a, b) => {
			const aGit = a.gitName.toLowerCase();
			const bGit = b.gitName.toLowerCase();
			const aName = a.name.toLowerCase();
			const bName = b.name.toLowerCase();
			const aExact = aName === search || aGit === search;
			const bExact = bName === search || bGit === search;
			if (aExact !== bExact) return aExact ? -1 : 1;
			const aNameStarts = aName.startsWith(search);
			const bNameStarts = bName.startsWith(search);
			if (aNameStarts !== bNameStarts) return aNameStarts ? -1 : 1;
			const aGitStarts = aGit.startsWith(search);
			const bGitStarts = bGit.startsWith(search);
			if (aGitStarts !== bGitStarts) return aGitStarts ? -1 : 1;
			return aGit.indexOf(search) - bGit.indexOf(search);
		});
	};
	const [stashes, setStashes] = createSignal<StashEntry[] | null>(null);
	const stashPickerSignal = createSignal(false);
	const [status, setStatus] = createSignal<'publish' | 'diverged' | 'ahead' | 'behind' | null>(
		null
	);
	const [actioning, setActioning] = createSignal(false);
	const [stashActioning, setStashActioning] = createSignal(false);
	const [previous, setPrevious] = createSignal<string | undefined>('');

	const fetching = createStoreListener(
		[LocationStore],
		() => LocationStore.isRefetchingSelectedRepository
	);

	const iconVariant = createStoreListener([SettingsStore], () => {
		return SettingsStore.getSetting('ui.thinIcons') ? 24 : 16;
	});

	const branchPickerSignal = createSignal(false);

	// Repo picker state
	const repoPickerSignal = createSignal(false);
	const [repoFilter, setRepoFilter] = createSignal('');
	const repositories = createStoreListener([RepositoryStore], () => RepositoryStore.repositories);
	const files = createStoreListener([FileStore], () => FileStore.files);
	const affinities = createStoreListener([AffinityStore], () => AffinityStore);

	const filteredRepos = createMemo((): Repository[] => {
		const filterValue = repoFilter().toLowerCase();
		const searchable = Array.from(repositories()?.values() || []).sort((a, b) =>
			a.name.localeCompare(b.name)
		);
		return searchable
			.filter((repo) => {
				if (!filterValue) return true;
				return (
					repo.name.toLowerCase().includes(filterValue) ||
					repo.path.toLowerCase().includes(filterValue) ||
					repo.remote.toLowerCase().includes(filterValue)
				);
			})
			.sort((a, b) => affinities()?.sort(a, b) || 0);
	});

	createEffect(() => {
		if (!branchPickerSignal[0]()) {
			setBranchSearch('');
		}
	});

	createEffect(() => {
		if (!repoPickerSignal[0]()) {
			setRepoFilter('');
		}
	});

	window.Native.listeners.BRANCHES(() => {
		branchPickerSignal[1]((b) => !b);
	});

	createEffect(async () => {
		if (!repository()) return;

		const previous = await Git.PreviousCommit(repository());

		if (!previous) return setPrevious(undefined);

		setPrevious(previous);
	});

	createEffect(() => {
		if (!repository()) return;

		if (!repository()?.remote && !RemoteStore.getByRepoPath(repository()?.path || '').length) {
			return setStatus('publish');
		}

		const ahead = repository()?.ahead || 0;
		const behind = repository()?.behind || 0;

		if (ahead === 0 && behind === 0) {
			const current = branches()?.find((b) => b.gitName === repository()?.branch);

			if (!current) return setStatus(null);

			if (!current.hasUpstream) {
				return setStatus('publish');
			} else {
				return setStatus(null);
			}
		}

		if (ahead > 0 && behind > 0) {
			setStatus('diverged');
		} else if (ahead > 0) {
			setStatus('ahead');
		} else if (behind > 0) {
			setStatus('behind');
		} else setStatus(null);
	});

	createStoreListener([LocationStore, RepositoryStore], async () => {
		if (!LocationStore.selectedRepository) {
			setStashes(null);
			setBranches(null);
		}

		try {
			const res = await Git.ListStash(LocationStore.selectedRepository!);

			setStashes(res);
		} catch (e) {
			showErrorModal(e, 'error.fetching');

			error(e);
		}

		try {
			const res = await Git.ListBranches(LocationStore.selectedRepository);

			setBranches(res);
		} catch (e) {
			showErrorModal(e, 'error.fetching');

			error(e);
		}
	});

	return (
		<div class="workspace__header">
			{/* Left section: Repo + Branch selectors */}
			<div class="workspace__header__selectors">
				{/* Repository Picker */}
				<Popout
					trapFocus
					position="bottom"
					align="start"
					open={repoPickerSignal}
					body={() => (
						<div class="repo-picker">
							<div class="repo-picker__search">
								<Icon name="search" variant={16} />
								<input
									type="text"
									placeholder={t('sidebar.drawer.title')}
									spellcheck={false}
									autocomplete="off"
									value={repoFilter()}
									onInput={(e) => setRepoFilter(e.currentTarget.value)}
								/>
							</div>
							<div class="repo-picker__list">
								<For each={filteredRepos()}>
									{(repo) => (
										<Menu
											interfaceId="header-repo-picker"
											items={[
												{
													type: 'item',
													label: t('sidebar.contextMenu.viewIn', {
														name:
															window.Native.platform === 'darwin'
																? 'Finder'
																: 'Explorer'
													}),
													onClick: () => showItemInFolder(repo.path)
												},
												{
													label: t('sidebar.contextMenu.openRemote'),
													type: 'item',
													onClick: () => openExternal(repo.remote)
												},
												{
													label: t('sidebar.contextMenu.openIn', {
														name: t(
															`settings.general.editor.${
																SettingsStore.getSetting('externalEditor') || 'code'
															}`
														)
													}),
													type: 'item',
													onClick: () => openInEditor(repo.path)
												},
												{ type: 'separator' },
												{
													type: 'item',
													label: t('sidebar.drawer.contextMenu.remove'),
													color: 'danger',
													onClick: () => removeRepository(repo)
												}
											]}
										>
											<button
												classList={{
													'repo-picker__list__item': true,
													active: repository()?.id === repo.id
												}}
												onClick={() => {
													repoPickerSignal[1](false);
													RepositoryStore.makePermanent(repo);
													LocationStore.setSelectedRepository(repo);
												}}
											>
												<div class="repo-picker__list__item__text">
													<span class="repo-picker__list__item__name">
														{repo.name}
													</span>
													<span class="repo-picker__list__item__detail">
														<Show when={repo.branch}>
															{repo.branch}
															{' \u2022 '}
														</Show>
														{renderDate(repo.lastFetched || new Date().getTime())()}
													</span>
												</div>
												<Show
													when={
														hasUncommittedChanges(files()!, repo) ||
														repo.ahead ||
														repo.behind
													}
												>
													<div class="repo-picker__list__item__indicator" />
												</Show>
											</button>
										</Menu>
									)}
								</For>
							</div>
							<div class="repo-picker__actions">
								<button
									class="repo-picker__action"
									onClick={() => {
										repoPickerSignal[1](false);
										showRepoModal('add');
									}}
								>
									<Icon name="plus" variant={16} />
									{t('sidebar.drawer.contextMenu.addRepository')}
								</button>
								<button
									class="repo-picker__action"
									onClick={() => {
										repoPickerSignal[1](false);
										ModalStore.pushState(
											'clone',
											createRoot(() => <CloneModal />)
										);
									}}
								>
									<Icon name="repo-clone" variant={16} />
									{t('sidebar.drawer.contextMenu.cloneRepository')}
								</button>
							</div>
						</div>
					)}
				>
					{(p) => (
						<button
							ref={p.ref}
							classList={{
								'workspace__header__selector': true,
								'workspace__header__selector--repo': true,
								active: p.open()
							}}
							onMouseDown={(e) => p.toggle(e)}
						>
							<Icon name="repo" variant={16} />
							<span class="workspace__header__selector__label">
								{repository()?.name || t('sidebar.noRepo')}
							</span>
							<Icon name="chevron-down" variant={16} />
						</button>
					)}
				</Popout>

				{/* Branch Picker */}
				<Popout
					trapFocus
					position="bottom"
					align="start"
					open={branchPickerSignal}
					body={() => (
						<div class="branches-picker">
							<div class="branches-picker__label" tabIndex={0}>
								{t('git.branches', undefined, branches()?.length)}
							</div>
							<div class="branches-picker__search">
								<Icon name="search" />
								<input
									type="text"
									placeholder={t('git.searchBranches')}
									spellcheck={false}
									autocomplete="off"
									value={branchSearch()}
									onInput={(e) => setBranchSearch(e.currentTarget.value)}
								/>
							</div>
							<div class="branches-picker__list">
								<For each={filteredBranches()}>
									{(branch) => (
										<Menu
											interfaceId="workspace-branch"
											items={[
												{
													type: 'item',
													label: t('git.deleteBranch'),
													color: 'danger',
													onClick: async () => {
														try {
															await Git.DeleteBranch(
																LocationStore.selectedRepository,
																branch.gitName
															);
															refetchRepository(
																LocationStore.selectedRepository
															);
														} catch (e) {
															showErrorModal(e, 'error.git');
															error(e);
														}
													}
												},
												{
													type: 'item',
													label: t('git.cherryPick', {
														current: repository()?.branch,
														branch: branch.gitName
													}),
													disabled: branch.gitName === repository()?.branch,
													onClick: () => {
														showCherryPickModal(repository(), branch);
													}
												},
												{
													type: 'item',
													label: t('git.mergeBranch', {
														current: repository()?.branch,
														branch: branch.gitName
													}),
													disabled: branch.gitName === repository()?.branch,
													onClick: async () => {
														try {
															await Git.Merge(
																LocationStore.selectedRepository,
																branch.gitName
															);
															refetchRepository(
																LocationStore.selectedRepository
															);
														} catch (e) {
															showErrorModal(e, 'error.git');
															error(e);
														}
													}
												},
												{
													type: 'item',
													label: t('sidebar.contextMenu.openRemote'),
													disabled: !(branch.hasUpstream || branch.isRemote),
													onClick: () => {
														const remote =
															LocationStore.selectedRepository?.remote.replace(
																/\.git$/,
																''
															);
														if (
															remote &&
															(branch.hasUpstream || branch.isRemote)
														) {
															const url = `${remote}${branchFormatsForProvider(remote, branch.gitName.replace(/^origin\//, ''))}`;
															openExternal(url);
														}
													}
												}
											]}
										>
											<button
												aria-selected={branch.gitName === repository()?.branch}
												role="option"
												aria-label={branch.gitName}
												classList={{
													'branches-picker__list__item': true,
													active: branch.gitName === repository()?.branch
												}}
												onClick={async () => {
													try {
														if (branch.gitName === repository()?.branch) {
															return;
														}
														await Git.Checkout(
															LocationStore.selectedRepository,
															branch.gitName
														);
														refetchRepository(
															LocationStore.selectedRepository
														);
													} catch (e) {
														const msg =
															typeof e === 'string'
																? e
																: (e as Error)?.message || '';
														if (
															msg
																.toLowerCase()
																.includes('resolve your current index')
														) {
															showConflictModal(
																LocationStore.selectedRepository
															);
														} else {
															showErrorModal(e, 'error.git');
														}
														error(e);
													}
												}}
											>
												<span class="branches-picker__list__item__name">
													<span class="branches-picker__list__item__name__path">
														{branch.path}
													</span>
													<span class="branches-picker__list__item__name__separator">
														{branch.path ? '/' : ''}
													</span>
													<span class="branches-picker__list__item__name__branch">
														{branch.name}
													</span>
												</span>
												<div class="branches-picker__list__item__info">
													{branch.relativeDate}
												</div>
											</button>
										</Menu>
									)}
								</For>
								<Show when={hasNewBranchInput()}>
									<div
										class="branches-picker__list__item branches-picker__list__item-new"
										ref={setInputRef}
									>
										<input
											type="text"
											placeholder="branch-name"
											spellcheck={false}
											inputmode="text"
											autocomplete="off"
											value={newBranch()}
											onInput={(e) => {
												setNewBranch(
													e.currentTarget.value
														.replace(/\s/g, '-')
														.replace(/[^a-zA-Z0-9-_/]/g, '')
												);
												e.currentTarget.value = newBranch();
											}}
											onKeyDown={async (e) => {
												if (e.key === 'Escape') {
													setHasNewBranchInput(false);
												}
												if (e.key === 'Enter') {
													if (!newBranch()) return;
													if (newBranch() === repository()?.branch) {
														setNewBranch('');
														return;
													}
													if (branches()?.find((b) => b.gitName === newBranch())) {
														setNewBranch('');
														return;
													}
													try {
														await Git.CreateBranch(
															LocationStore.selectedRepository,
															newBranch(),
															true
														);
														setHasNewBranchInput(false);
														refetchRepository(
															LocationStore.selectedRepository
														);
													} catch (e) {
														showErrorModal(e, 'error.git');
														error(e);
													}
												}
											}}
										/>
										<button
											class="branches-picker__list__item-new__hint"
											aria-label={t('git.createBranch')}
											role="button"
											onClick={async () => {
												const input = inputRef()?.querySelector('input');
												if (!input?.value) return;
												if (input.value === repository()?.branch) {
													setNewBranch('');
													return;
												}
												if (branches()?.find((b) => b.gitName === input.value)) {
													setNewBranch('');
													return;
												}
												try {
													await Git.CreateBranch(
														LocationStore.selectedRepository,
														input.value,
														true
													);
													setHasNewBranchInput(false);
													refetchRepository(LocationStore.selectedRepository);
												} catch (e) {
													showErrorModal(e, 'error.git');
													error(e);
												}
											}}
										>
											\u21A9
										</button>
									</div>
								</Show>
							</div>
							<div class="branches-picker__actions">
								<button
									class="branches-picker__new"
									onClick={() => {
										setHasNewBranchInput((v) => !v);
										requestAnimationFrame(() => {
											inputRef()?.querySelector('input')?.focus();
										});
									}}
								>
									<Icon name={hasNewBranchInput() ? 'fold-up' : 'plus'} />
									{hasNewBranchInput() ? t('git.hide') : t('git.newBranch')}
								</button>
								</div>
						</div>
					)}
				>
					{(p) => (
						<button
							ref={p.ref}
							disabled={!repository() || branches() === null}
							classList={{
								'workspace__header__selector': true,
								'workspace__header__selector--branch': true,
								active: p.open()
							}}
							onMouseDown={(e) => p.toggle(e)}
						>
							<Icon name="git-branch" variant={16} />
							<span class="workspace__header__selector__label">
								{repository()?.branch || t('sidebar.noBranch')}
							</span>
							<Icon name="chevron-down" variant={16} />
						</button>
					)}
				</Popout>
			</div>

			{/* Right section: Action buttons */}
			<div class="workspace__header__spacer" />

			<PanelButton
				icon="git-merge-queue"
				label={t('modal.sequentialMerge.sequentialMerge')}
				disabled={!repository() || !branches()?.length}
				id="workspace-sequential-merge"
				onMouseDown={() => {
					showSequentialMergeModal(repository(), branches() || []);
				}}
			/>

			<PanelButton
				loading={fetching()}
				detail={renderDate(repository()?.lastFetched || new Date().getTime())()}
				label={t('git.sync')}
				icon="sync"
				iconVariant={iconVariant()}
				id="workspace-fetch-changes-and-remote"
				disabled={!repository()}
				onMouseDown={() => {
					refetchRepository(LocationStore.selectedRepository);
				}}
			/>
			<Menu
				interfaceId="workspace-pull"
				items={[
					status() === 'ahead' &&
						({
							label: t('git.undo', {
								sha: previous()?.substring(0, 7)
							}),
							onClick: async () => {
								if (!repository()) return;

								try {
									const previousDetails = await Git.Details(
										repository()?.path,
										previous() || 'HEAD^1'
									);

									if (
										!DraftStore.getDraft(repository()).message &&
										previousDetails?.message
									) {
										const message = previousDetails.message.split('\n')[0];
										const description = previousDetails.message
											.split('\n')
											.slice(1)
											.join('\n');

										DraftStore.setDraft(repository(), {
											message,
											description
										});
									}

									await Git.Reset(
										LocationStore.selectedRepository,
										await Git.PreviousCommit(repository(), previous())
									);

									refetchRepository(LocationStore.selectedRepository);
								} catch (e) {
									showErrorModal(e, 'error.git');

									error(e);
								}
							},
							type: 'item'
						} as const)
				].filter(Boolean)}
			>
				<PanelButton
					loading={actioning()}
					icon={((): IconName => {
						switch (status()) {
							case 'ahead':
								return 'repo-push';
							case 'behind':
								return 'repo-pull';
							case 'publish':
								return 'repo-template';
							case 'diverged':
								return 'repo-forked';
							default:
								return 'repo';
						}
					})()}
					iconVariant={iconVariant()}
					label={(() => {
						switch (status()) {
							case 'ahead':
								return t('git.pushChanges');
							case 'behind':
								return t('git.pullChanges');
							case 'publish':
								return t('git.publish');
							case 'diverged':
								return t('git.diverged');
							default:
								return t('git.noChanges');
						}
					})()}
					id="workspace-pull"
					disabled={!repository() || status() === null}
					detail={(() => {
						const ahead = repository()?.ahead || 0;
						const behind = repository()?.behind || 0;

						switch (status()) {
							case 'ahead':
								return t(
									'git.commits',
									{ count: Math.abs(ahead) },
									Math.abs(ahead)
								);
							case 'behind':
								return t(
									'git.commits',
									{ count: Math.abs(behind) },
									Math.abs(behind)
								);
							case 'diverged':
								return t('git.divergedHint');
							case 'publish':
								return t('git.publishHint');
							default:
								return t('git.nothingToSee');
						}
					})()}
					onClick={async () => {
						if (!repository()) return;

						if (status() === null) return;

						setActioning(true);

						switch (status()) {
							case 'ahead': {
								debug('Pushing changes');

								try {
									await Git.Push(LocationStore.selectedRepository);

									triggerWorkflow('push', LocationStore.selectedRepository!);
								} catch (e) {
									showErrorModal(e, 'error.git');

									error(e);
								}

								setActioning(false);

								refetchRepository(LocationStore.selectedRepository);

								return;
							}
							case 'behind': {
								debug('Pulling changes');

								try {
									await Git.Pull(LocationStore.selectedRepository);
								} catch (e) {
									showErrorModal(e, 'error.git');

									error(e);
								}

								setActioning(false);

								refetchRepository(LocationStore.selectedRepository);

								return;
							}
							case 'diverged': {
								debug('Diverged');

								try {
									await Git.Stash(LocationStore.selectedRepository);

									triggerWorkflow('stash', LocationStore.selectedRepository!);

									await Git.Pull(LocationStore.selectedRepository);

									triggerWorkflow('pull', LocationStore.selectedRepository!);
								} catch (e) {
									showErrorModal(e, 'error.git');

									error(e);
								}

								setActioning(false);

								refetchRepository(LocationStore.selectedRepository);
								return;
							}
							case 'publish': {
								debug('Publishing');

								if (
									!repository()?.remote &&
									!RemoteStore.getByRepoPath(repository()?.path || '').length
								) {
									showPublishModal(repository());

									setActioning(false);

									return;
								}

								try {
									await Git.PushWithOrigin(
										LocationStore.selectedRepository,
										repository()?.branch
									);

									triggerWorkflow('push', LocationStore.selectedRepository!);
								} catch (e) {
									showErrorModal(e, 'error.git');

									error(e);
								}

								setActioning(false);
								refetchRepository(LocationStore.selectedRepository);

								return;
							}
							default: {
								return debug('No change');
							}
						}
					}}
				/>
			</Menu>
			<Show when={(stashes() || []).length > 0}>
				<Popout
					position="bottom"
					align="end"
					open={stashPickerSignal}
					body={() => (
						<div class="stash-picker">
							<div class="stash-picker__label" tabIndex={0}>
								{t(
									'git.stashedChanges',
									{
										stashCount: stashes()!.length,
										count: t(
											'git.files',
											{
												count: stashes()![0].files.length
											},
											stashes()![0].files.length
										)
									},
									stashes()!.length
								)}
							</div>
							<div class="stash-picker__list">
								<For each={stashes()}>
									{(stash) => (
										<Menu
											interfaceId="workspace-stash-item"
											items={[
												{
													type: 'item',
													label: t('git.popStash'),
													onClick: async () => {
														if (!repository()) return;

														setStashActioning(true);

														try {
															await Git.PopStash(
																LocationStore.selectedRepository,
																stash.index
															);

															triggerWorkflow(
																'stash_pop',
																LocationStore.selectedRepository!
															);

															stashPickerSignal[1](false);

															refetchRepository(
																LocationStore.selectedRepository
															);
														} catch (e) {
															showErrorModal(e, 'error.git');
															error(e);
														} finally {
															setStashActioning(false);
														}
													}
												},
												{
													type: 'item',
													label: t('git.removeStash'),
													color: 'danger',
													onClick: async () => {
														if (!repository()) return;

														setStashActioning(true);

														try {
															await Git.RemoveStash(
																LocationStore.selectedRepository,
																stash.index
															);

															refetchRepository(
																LocationStore.selectedRepository
															);
														} catch (e) {
															showErrorModal(e, 'error.git');
															error(e);
														} finally {
															setStashActioning(false);
														}
													}
												}
											]}
										>
											<button
												class="stash-picker__list__item"
												onClick={async () => {
													if (!repository()) return;

													stashPickerSignal[1](false);

													try {
														const stashDiff = await Git.ShowStash(
															LocationStore.selectedRepository,
															stash.index
														);

														if (stashDiff) {
															LocationStore.setStashOpen(true);
															LocationStore.setSelectedCommit({
																hash: `stash@{${stash.index}}`,
																refs: '',
																parent: '',
																message:
																	stash.message ||
																	`stash@{${stash.index}}`,
																author: stash.branch,
																date: '',
																files: stashDiff.files.length,
																insertions: 0,
																deletions: 0
															});
															LocationStore.setSelectedCommitFiles({
																hash: `stash@{${stash.index}}`,
																files: stashDiff.files
															});
															LocationStore.setSelectedCommitFile(
																stashDiff.files[0]
															);
														}
													} catch (e) {
														showErrorModal(e, 'error.git');
														error(e);
													}
												}}
											>
												<div class="stash-picker__list__item__content">
													<div class="stash-picker__list__item__content__message">
														{stash.message || `stash@${stash.index}`}
													</div>
													<div class="stash-picker__list__item__content__meta">
														{stash.branch}
													</div>
												</div>
												<div class="stash-picker__list__item__info">
													{t(
														'git.files',
														{ count: stash.files.length },
														stash.files.length
													)}
												</div>
											</button>
										</Menu>
									)}
								</For>
							</div>
						</div>
					)}
				>
					{(p) => (
						<PanelButton
							ref={p.ref}
							icon="file-directory"
							iconVariant={iconVariant()}
							id="workspace-stash-picker"
							loading={stashActioning()}
							className={p.open() ? 'active' : ''}
							label={t('git.stashes')}
							detail={t(
								'git.stashCount',
								{ count: stashes()!.length },
								stashes()!.length
							)}
							onMouseDown={(e) => {
								p.toggle(e);
							}}
						/>
					)}
				</Popout>
			</Show>
		</div>
	);
};
