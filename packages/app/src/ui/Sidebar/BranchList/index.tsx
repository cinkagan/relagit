import { For, Show, createEffect, createSignal } from 'solid-js';

import { Branch } from '@app/modules/git/branches';
import * as Git from '@app/modules/git';
import { t } from '@app/modules/i18n';
import { createStoreListener } from '@stores/index';
import LocationStore from '@stores/location';
import RepositoryStore from '@stores/repository';

import EmptyState from '../../Common/EmptyState';
import Icon from '../../Common/Icon';

import './index.scss';

export default () => {
	const repository = createStoreListener([LocationStore, RepositoryStore], () =>
		RepositoryStore.getById(LocationStore.selectedRepository?.id)
	);

	const [branches, setBranches] = createSignal<Branch[]>([]);
	const [search, setSearch] = createSignal('');
	const [localCollapsed, setLocalCollapsed] = createSignal(false);
	const [remoteCollapsed, setRemoteCollapsed] = createSignal(true);

	const selectedBranch = createStoreListener(
		[LocationStore],
		() => LocationStore.selectedHistoryBranch
	);

	createEffect(async () => {
		const repo = LocationStore.selectedRepository;
		if (!repo) return;

		try {
			const res = await Git.ListBranches(repo);
			setBranches(res);
		} catch {
			setBranches([]);
		}
	});

	const filterBySearch = (list: Branch[]) => {
		const s = search().toLowerCase().trim();
		if (!s) return list;
		return list.filter(
			(b) => b.gitName.toLowerCase().includes(s) || b.name.toLowerCase().includes(s)
		);
	};

	const localBranches = () => filterBySearch(branches().filter((b) => !b.isRemote));
	const remoteBranches = () => filterBySearch(branches().filter((b) => b.isRemote));

	return (
		<div class="branch-list">
			<div class="branch-list__search">
				<Icon name="search" variant={16} />
				<input
					type="text"
					placeholder={t('git.searchBranches')}
					spellcheck={false}
					autocomplete="off"
					value={search()}
					onInput={(e) => setSearch(e.currentTarget.value)}
				/>
				<Show when={search()}>
					<button
						class="branch-list__search__clear"
						onClick={() => setSearch('')}
					>
						<Icon name="x" variant={16} />
					</button>
				</Show>
			</div>
			<div class="branch-list__items">
				<Show when={localBranches().length > 0}>
					<button
						class="branch-list__group"
						onClick={() => setLocalCollapsed((v) => !v)}
					>
						<Icon
							name={localCollapsed() ? 'chevron-right' : 'chevron-down'}
							variant={16}
						/>
						<Icon name="git-branch" variant={16} />
						<span class="branch-list__group__label">
							{t('modal.sequentialMerge.local')}
						</span>
						<span class="branch-list__group__count">
							{localBranches().length}
						</span>
					</button>
					<Show when={!localCollapsed()}>
						<For each={localBranches()}>
							{(branch) => (
								<button
									classList={{
										'branch-list__item': true,
										active:
											selectedBranch() === branch.gitName ||
											(!selectedBranch() &&
												branch.gitName === repository()?.branch)
									}}
									onClick={() => {
										LocationStore.setSelectedHistoryBranch(branch.gitName);
										LocationStore.setSelectedCommit(undefined);
										LocationStore.setSelectedCommitFiles(undefined);
										LocationStore.setSelectedCommitFile(undefined);
									}}
								>
									<Icon name="git-branch" variant={16} />
									<div class="branch-list__item__name">
										<Show when={branch.path}>
											<span class="branch-list__item__path">
												{branch.path}/
											</span>
										</Show>
										{branch.name}
									</div>
									<Show
										when={branch.gitName === repository()?.branch}
									>
										<span class="branch-list__item__current">
											<Icon name="dot-fill" variant={16} />
										</span>
									</Show>
								</button>
							)}
						</For>
					</Show>
				</Show>
				<Show when={remoteBranches().length > 0}>
					<button
						class="branch-list__group"
						onClick={() => setRemoteCollapsed((v) => !v)}
					>
						<Icon
							name={remoteCollapsed() ? 'chevron-right' : 'chevron-down'}
							variant={16}
						/>
						<Icon name="globe" variant={16} />
						<span class="branch-list__group__label">
							{t('modal.sequentialMerge.remote')}
						</span>
						<span class="branch-list__group__count">
							{remoteBranches().length}
						</span>
					</button>
					<Show when={!remoteCollapsed()}>
						<For each={remoteBranches()}>
							{(branch) => (
								<button
									classList={{
										'branch-list__item': true,
										active: selectedBranch() === branch.gitName
									}}
									onClick={() => {
										LocationStore.setSelectedHistoryBranch(branch.gitName);
										LocationStore.setSelectedCommit(undefined);
										LocationStore.setSelectedCommitFiles(undefined);
										LocationStore.setSelectedCommitFile(undefined);
									}}
								>
									<Icon name="globe" variant={16} />
									<div class="branch-list__item__name">
										<Show when={branch.path}>
											<span class="branch-list__item__path">
												{branch.path}/
											</span>
										</Show>
										{branch.name}
									</div>
								</button>
							)}
						</For>
					</Show>
				</Show>
				<Show when={localBranches().length === 0 && remoteBranches().length === 0}>
					<EmptyState hint={t('palette.empty')} icon="search" />
				</Show>
			</div>
		</div>
	);
};
