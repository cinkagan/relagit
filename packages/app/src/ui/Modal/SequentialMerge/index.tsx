import Modal, { ModalBody, ModalCloseButton, ModalFooter, ModalHeader, showErrorModal } from '..';
import { For, Show, createRoot, createSignal } from 'solid-js';

import { Branch } from '@app/modules/git/branches';
import { t } from '@app/modules/i18n';
import { startSequentialMerge } from '~/app/src/modules/git/sequential-merge';
import ModalStore from '~/app/src/stores/modal';
import { Repository } from '~/app/src/stores/repository';

import Button from '../../Common/Button';
import EmptyState from '../../Common/EmptyState';
import Icon from '../../Common/Icon';

import './index.scss';

export const SequentialMergeModal = (props: {
	repository: Repository;
	branches: Branch[];
}) => {
	const [selectedBranches, setSelectedBranches] = createSignal<Branch[]>([]);
	const [search, setSearch] = createSignal('');
	const [localCollapsed, setLocalCollapsed] = createSignal(false);
	const [remoteCollapsed, setRemoteCollapsed] = createSignal(true);

	const filterBySearch = (branches: Branch[]) => {
		const s = search().toLowerCase().trim();
		if (!s) return branches;
		return branches.filter(
			(b) => b.gitName.toLowerCase().includes(s) || b.name.toLowerCase().includes(s)
		);
	};

	const localBranches = () =>
		filterBySearch(
			props.branches.filter(
				(b) => b.gitName !== props.repository.branch && !b.isRemote
			)
		);

	const remoteBranches = () =>
		filterBySearch(
			props.branches.filter(
				(b) => b.gitName !== props.repository.branch && b.isRemote
			)
		);

	const isSelected = (branch: Branch) =>
		selectedBranches().some((b) => b.gitName === branch.gitName);

	const toggleBranch = (branch: Branch) => {
		if (isSelected(branch)) {
			setSelectedBranches((prev) => prev.filter((b) => b.gitName !== branch.gitName));
		} else {
			setSelectedBranches((prev) => [...prev, branch]);
		}
	};

	const moveBranch = (index: number, direction: -1 | 1) => {
		const newIndex = index + direction;
		if (newIndex < 0 || newIndex >= selectedBranches().length) return;

		setSelectedBranches((prev) => {
			const arr = [...prev];
			const temp = arr[index];
			arr[index] = arr[newIndex];
			arr[newIndex] = temp;
			return arr;
		});
	};

	const removeBranch = (index: number) => {
		setSelectedBranches((prev) => prev.filter((_, i) => i !== index));
	};

	const BranchItem = (itemProps: { branch: Branch }) => (
		<button
			classList={{
				'seq-merge__branch': true,
				'seq-merge__branch--selected': isSelected(itemProps.branch)
			}}
			onClick={() => toggleBranch(itemProps.branch)}
		>
			<div class="seq-merge__branch__checkbox">
				<Show
					when={isSelected(itemProps.branch)}
					fallback={<Icon name="square" variant={16} />}
				>
					<Icon name="check-circle-fill" variant={16} />
				</Show>
			</div>
			<div class="seq-merge__branch__info">
				<span class="seq-merge__branch__name">
					<Show when={itemProps.branch.path}>
						<span class="seq-merge__branch__path">
							{itemProps.branch.path}/
						</span>
					</Show>
					{itemProps.branch.name}
				</span>
				<span class="seq-merge__branch__meta">{itemProps.branch.relativeDate}</span>
			</div>
		</button>
	);

	const GroupHeader = (headerProps: {
		collapsed: boolean;
		onToggle: () => void;
		icon: 'git-branch' | 'globe';
		label: string;
		count: number;
	}) => (
		<button class="seq-merge__group" onClick={headerProps.onToggle}>
			<Icon
				name={headerProps.collapsed ? 'chevron-right' : 'chevron-down'}
				variant={16}
			/>
			<Icon name={headerProps.icon} variant={16} />
			<span class="seq-merge__group__label">{headerProps.label}</span>
			<span class="seq-merge__group__count">{headerProps.count}</span>
		</button>
	);

	return (
		<Modal size="x-large" dismissable id={'sequentialMerge'}>
			{(p) => {
				return (
					<>
						<ModalHeader
							title={t('modal.sequentialMerge.title', {
								current: props.repository.branch
							})}
						>
							<ModalCloseButton close={p.close} />
						</ModalHeader>
						<ModalBody>
							<div class="seq-merge">
								{/* Left panel: branch picker */}
								<div class="seq-merge__picker">
									<div class="seq-merge__picker__search">
										<Icon name="search" variant={16} />
										<input
											type="text"
											placeholder={t('git.searchBranches')}
											spellcheck={false}
											autocomplete="off"
											value={search()}
											onInput={(e) =>
												setSearch(e.currentTarget.value)
											}
										/>
										<Show when={search()}>
											<button
												class="seq-merge__picker__search__clear"
												onClick={() => setSearch('')}
											>
												<Icon name="x" variant={16} />
											</button>
										</Show>
									</div>
									<div class="seq-merge__picker__list">
										<Show when={localBranches().length > 0}>
											<GroupHeader
												collapsed={localCollapsed()}
												onToggle={() =>
													setLocalCollapsed((v) => !v)
												}
												icon="git-branch"
												label={t('modal.sequentialMerge.local')}
												count={localBranches().length}
											/>
											<Show when={!localCollapsed()}>
												<For each={localBranches()}>
													{(branch) => (
														<BranchItem branch={branch} />
													)}
												</For>
											</Show>
										</Show>
										<Show when={remoteBranches().length > 0}>
											<GroupHeader
												collapsed={remoteCollapsed()}
												onToggle={() =>
													setRemoteCollapsed((v) => !v)
												}
												icon="globe"
												label={t('modal.sequentialMerge.remote')}
												count={remoteBranches().length}
											/>
											<Show when={!remoteCollapsed()}>
												<For each={remoteBranches()}>
													{(branch) => (
														<BranchItem branch={branch} />
													)}
												</For>
											</Show>
										</Show>
										<Show
											when={
												localBranches().length === 0 &&
												remoteBranches().length === 0
											}
										>
											<div class="seq-merge__picker__empty">
												<Icon name="search" variant={16} />
												<span>{t('palette.empty')}</span>
											</div>
										</Show>
									</div>
								</div>

								{/* Divider */}
								<div class="seq-merge__divider" />

								{/* Right panel: merge tree */}
								<div class="seq-merge__tree">
									<div class="seq-merge__tree__header">
										<Icon name="git-merge-queue" variant={16} />
										<span>
											{t('modal.sequentialMerge.mergeOrder')}
										</span>
										<Show when={selectedBranches().length > 0}>
											<span class="seq-merge__tree__header__count">
												{selectedBranches().length}
											</span>
										</Show>
									</div>
									<div class="seq-merge__tree__body">
										<Show
											when={selectedBranches().length > 0}
											fallback={
												<EmptyState
													icon="git-merge-queue"
													detail={t(
														'modal.sequentialMerge.emptyQueue'
													)}
													hint={t(
														'modal.sequentialMerge.emptyQueueHint'
													)}
												/>
											}
										>
											<div class="seq-merge__graph">
												{/* Top: current branch */}
												<div class="seq-merge__graph__node seq-merge__graph__node--current">
													<div class="seq-merge__graph__rail">
														<div class="seq-merge__graph__dot seq-merge__graph__dot--current" />
														<div class="seq-merge__graph__rail__line" />
													</div>
													<div class="seq-merge__graph__tag seq-merge__graph__tag--current">
														<Icon name="git-branch" variant={16} />
														<span>{props.repository.branch}</span>
													</div>
												</div>

												{/* Merge rows */}
												<For each={selectedBranches()}>
													{(branch, i) => (
														<div
															class="seq-merge__graph__node seq-merge__graph__node--merge"
															onMouseEnter={(e) =>
																e.currentTarget.classList.add(
																	'hover'
																)
															}
															onMouseLeave={(e) =>
																e.currentTarget.classList.remove(
																	'hover'
																)
															}
														>
															<div class="seq-merge__graph__rail">
																<div class="seq-merge__graph__dot seq-merge__graph__dot--merge" />
																<Show
																	when={
																		i() <
																		selectedBranches()
																			.length -
																			1
																	}
																>
																	<div class="seq-merge__graph__rail__line" />
																</Show>
															</div>
															<div class="seq-merge__graph__connector" />
															<div class="seq-merge__graph__card">
																<span class="seq-merge__graph__card__order">
																	{i() + 1}
																</span>
																<Icon
																	name={
																		branch.isRemote
																			? 'globe'
																			: 'git-branch'
																	}
																	variant={16}
																	className="seq-merge__graph__card__icon"
																/>
																<span class="seq-merge__graph__card__name">
																	{branch.gitName}
																</span>
																<div class="seq-merge__graph__card__actions">
																	<button
																		disabled={
																			i() === 0
																		}
																		onClick={() =>
																			moveBranch(
																				i(),
																				-1
																			)
																		}
																		aria-label="Move up"
																	>
																		<Icon
																			name="arrow-up"
																			variant={16}
																		/>
																	</button>
																	<button
																		disabled={
																			i() ===
																			selectedBranches()
																				.length -
																				1
																		}
																		onClick={() =>
																			moveBranch(
																				i(),
																				1
																			)
																		}
																		aria-label="Move down"
																	>
																		<Icon
																			name="arrow-down"
																			variant={16}
																		/>
																	</button>
																	<button
																		class="seq-merge__graph__card__remove"
																		onClick={() =>
																			removeBranch(
																				i()
																			)
																		}
																		aria-label="Remove"
																	>
																		<Icon
																			name="x"
																			variant={16}
																		/>
																	</button>
																</div>
															</div>
														</div>
													)}
												</For>

												{/* Bottom: result */}
												<div class="seq-merge__graph__node seq-merge__graph__node--result">
													<div class="seq-merge__graph__rail">
														<div class="seq-merge__graph__dot seq-merge__graph__dot--result" />
													</div>
													<div class="seq-merge__graph__tag seq-merge__graph__tag--result">
														<Icon
															name="check-circle"
															variant={16}
														/>
														<span>{props.repository.branch}</span>
													</div>
												</div>
											</div>
										</Show>
									</div>
								</div>
							</div>
						</ModalBody>
						<ModalFooter>
							<div class="modal__footer__buttons">
								<Button
									type="default"
									label={t('modal.cancel')}
									onClick={p.close}
								>
									{t('modal.cancel')}
								</Button>
								<Button
									type="brand"
									label={t('modal.sequentialMerge.start')}
									disabled={selectedBranches().length === 0}
									dedupe
									onClick={async () => {
										try {
											p.close();
											await startSequentialMerge(
												props.repository,
												selectedBranches().map((b) => b.gitName)
											);
										} catch (e) {
											showErrorModal(e, 'error.git');
										}
									}}
								>
									<Icon name="git-merge" variant={16} />
									{t('modal.sequentialMerge.start')}
									<Show when={selectedBranches().length > 0}>
										({selectedBranches().length})
									</Show>
								</Button>
							</div>
						</ModalFooter>
					</>
				);
			}}
		</Modal>
	);
};

export const showSequentialMergeModal = (
	repository: Repository | undefined,
	branches: Branch[]
) => {
	if (!repository) return;

	ModalStore.pushState(
		'sequentialMerge',
		createRoot(() => (
			<SequentialMergeModal repository={repository} branches={branches} />
		))
	);
};
