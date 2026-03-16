import { For, Show, createSignal } from 'solid-js';

import { t } from '@app/modules/i18n';
import { createStoreListener } from '@stores/index';
import LocationStore from '@stores/location';
import RepositoryStore from '@stores/repository';

import Icon from '../../Common/Icon';

import './index.scss';

export interface BranchPanelProps {
	branches: string[];
	selectedBranch: string | null;
	onSelectBranch: (branch: string | null) => void;
}

export default (props: BranchPanelProps) => {
	const repository = createStoreListener([LocationStore, RepositoryStore], () =>
		RepositoryStore.getById(LocationStore.selectedRepository?.id)
	);

	const [search, setSearch] = createSignal('');
	const [localCollapsed, setLocalCollapsed] = createSignal(false);
	const [remoteCollapsed, setRemoteCollapsed] = createSignal(true);

	const filterBySearch = (list: string[]) => {
		const s = search().toLowerCase().trim();
		if (!s) return list;
		return list.filter((b) => b.toLowerCase().includes(s));
	};

	const localBranches = () =>
		filterBySearch(props.branches.filter((b) => !b.startsWith('origin/')));
	const remoteBranches = () =>
		filterBySearch(props.branches.filter((b) => b.startsWith('origin/')));

	const handleBranchClick = (branch: string) => {
		// Toggle: if already selected, deselect
		if (props.selectedBranch === branch) {
			props.onSelectBranch(null);
		} else {
			props.onSelectBranch(branch);
		}
	};

	return (
		<div class="branch-panel">
			<div class="branch-panel__search">
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
						class="branch-panel__search__clear"
						onClick={() => setSearch('')}
					>
						<Icon name="x" variant={16} />
					</button>
				</Show>
			</div>
			<div class="branch-panel__items">
				<Show when={localBranches().length > 0}>
					<button
						class="branch-panel__group"
						onClick={() => setLocalCollapsed((v) => !v)}
					>
						<Icon
							name={localCollapsed() ? 'chevron-right' : 'chevron-down'}
							variant={16}
						/>
						<Icon name="git-branch" variant={16} />
						<span class="branch-panel__group__label">LOCAL</span>
						<span class="branch-panel__group__count">
							{localBranches().length}
						</span>
					</button>
					<Show when={!localCollapsed()}>
						<For each={localBranches()}>
							{(branch) => (
								<button
									classList={{
										'branch-panel__item': true,
										active: branch === repository()?.branch,
										selected: props.selectedBranch === branch
									}}
									onClick={() => handleBranchClick(branch)}
								>
									<Icon name="git-branch" variant={16} />
									<div class="branch-panel__item__name">
										{branch}
									</div>
									<Show when={branch === repository()?.branch}>
										<span class="branch-panel__item__current">
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
						class="branch-panel__group"
						onClick={() => setRemoteCollapsed((v) => !v)}
					>
						<Icon
							name={remoteCollapsed() ? 'chevron-right' : 'chevron-down'}
							variant={16}
						/>
						<Icon name="globe" variant={16} />
						<span class="branch-panel__group__label">REMOTE</span>
						<span class="branch-panel__group__count">
							{remoteBranches().length}
						</span>
					</button>
					<Show when={!remoteCollapsed()}>
						<For each={remoteBranches()}>
							{(branch) => (
								<button
									classList={{
										'branch-panel__item': true,
										selected: props.selectedBranch === branch
									}}
									onClick={() => handleBranchClick(branch)}
								>
									<Icon name="globe" variant={16} />
									<div class="branch-panel__item__name">
										{branch}
									</div>
								</button>
							)}
						</For>
					</Show>
				</Show>
				<Show when={props.branches.length === 0}>
					<div class="branch-panel__empty">
						No related branches
					</div>
				</Show>
			</div>
		</div>
	);
};
