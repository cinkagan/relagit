import Modal, { ModalBody, ModalCloseButton, ModalHeader, showErrorModal } from '../../Modal';
import { For, Show, createEffect, createRoot, createSignal } from 'solid-js';
import { getIconForFilePath, getIconUrlForFilePath } from 'vscode-material-icons';

import { statusToAlpha } from '@app/modules/git/diff';
import { LogCommit } from '@app/modules/git/log';
import { PastCommit } from '@app/modules/git/show';
import { t } from '@app/modules/i18n';
import { relative } from '@app/modules/time';
import * as Git from '@modules/git';
import ModalStore from '@stores/modal';
import { Repository } from '@stores/repository';
import LocationStore from '@stores/location';

import EmptyState from '../../Common/EmptyState';
import CodeView from '../CodeView';
import Icon from '../../Common/Icon';

import './CommitDetailModal.scss';

const path = window.Native.DANGEROUS__NODE__REQUIRE('path');

const CommitDetailModal = (props: { repository: Repository; commit: LogCommit }) => {
	const [commitData, setCommitData] = createSignal<PastCommit | null>(null);
	const [selectedFile, setSelectedFile] = createSignal<PastCommit['files'][number] | null>(null);
	const [loading, setLoading] = createSignal(true);

	const isMerge = () => props.commit.parent?.includes(' ');

	createEffect(async () => {
		setLoading(true);
		try {
			const result = await Git.Show(props.repository.path, props.commit.hash);
			setCommitData(result || null);
			if (result?.files[0]) {
				setSelectedFile(result.files[0]);
				LocationStore.setSelectedCommit(props.commit);
				LocationStore.setSelectedCommitFiles(result);
				LocationStore.setSelectedCommitFile(result.files[0]);
			}
		} catch (e) {
			showErrorModal(e, 'error.git');
		}
		setLoading(false);
	});

	const selectFile = (file: PastCommit['files'][number]) => {
		setSelectedFile(file);
		LocationStore.setSelectedCommit(props.commit);
		LocationStore.setSelectedCommitFiles(commitData()!);
		LocationStore.setSelectedCommitFile(file);
	};

	const stats = () => {
		const files = commitData()?.files || [];
		let additions = 0;
		let deletions = 0;
		for (const f of files) {
			for (const df of f.diff?.files || []) {
				for (const chunk of df.chunks || []) {
					for (const change of chunk.changes || []) {
						if (change.type === 'AddedLine') additions++;
						if (change.type === 'DeletedLine') deletions++;
					}
				}
			}
		}
		return { files: files.length, additions, deletions };
	};

	return (
		<Modal size="x-large" dismissable id={'commitDetail'}>
			{(p) => (
				<>
					<ModalHeader title={t('git.commitGraph.viewDetails')}>
						<ModalCloseButton close={p.close} />
					</ModalHeader>
					<ModalBody>
						<div class="commit-detail">
							{/* Commit info banner */}
							<div class="commit-detail__banner">
								<div class="commit-detail__banner__main">
									<div class="commit-detail__banner__message">
										{props.commit.message}
									</div>
									<div class="commit-detail__banner__meta">
										<span class="commit-detail__banner__author">
											<Icon name="person" variant={16} />
											{props.commit.author}
										</span>
										<span class="commit-detail__banner__hash">
											<Icon name="git-commit" variant={16} />
											{props.commit.hash.substring(0, 7)}
										</span>
										<span class="commit-detail__banner__date">
											<Icon name="clock" variant={16} />
											{relative(new Date(props.commit.date).getTime())}
										</span>
										<Show when={isMerge()}>
											<span class="commit-detail__banner__badge commit-detail__banner__badge--merge">
												<Icon name="git-merge" variant={16} />
												Merge
											</span>
										</Show>
									</div>
								</div>
								<Show when={!loading()}>
									<div class="commit-detail__banner__stats">
										<span class="commit-detail__banner__stats__files">
											{t('git.files', { count: stats().files }, stats().files)}
										</span>
										<Show when={stats().additions}>
											<span class="commit-detail__banner__stats__add">
												+{stats().additions}
											</span>
										</Show>
										<Show when={stats().deletions}>
											<span class="commit-detail__banner__stats__del">
												-{stats().deletions}
											</span>
										</Show>
									</div>
								</Show>
							</div>

							{/* Split view: files + diff */}
							<div class="commit-detail__split">
								<Show
									when={!loading()}
									fallback={
										<div class="commit-detail__loading">
											<EmptyState spinner hint="Loading diff..." />
										</div>
									}
								>
									{/* File list sidebar */}
									<div class="commit-detail__sidebar">
										<div class="commit-detail__sidebar__header">
											<Icon name="file-directory" variant={16} />
											{t('git.files', { count: stats().files }, stats().files)}
										</div>
										<div class="commit-detail__sidebar__list">
											<For each={commitData()!.files}>
												{(file) => (
													<button
														classList={{
															'commit-detail__file': true,
															'commit-detail__file--active':
																selectedFile() === file
														}}
														onClick={() => selectFile(file)}
													>
														<Show
															when={getIconForFilePath(
																file.filename
															)}
														>
															<img
																class="commit-detail__file__icon"
																src={getIconUrlForFilePath(
																	file.filename,
																	'./icons'
																)}
																alt={getIconForFilePath(
																	file.filename
																)}
															/>
														</Show>
														<div class="commit-detail__file__info">
															<Show when={file.from}>
																<span class="commit-detail__file__from">
																	{file.from}
																</span>
																<Icon
																	name="arrow-right"
																	variant={12}
																	className="commit-detail__file__arrow"
																/>
															</Show>
															<Show when={file.path}>
																<span class="commit-detail__file__path">
																	{file.path}/
																</span>
															</Show>
															<span class="commit-detail__file__name">
																{file.filename}
															</span>
														</div>
														<span
															classList={{
																'commit-detail__file__status':
																	true,
																[file.status]: true
															}}
														>
															{statusToAlpha(file.status)}
														</span>
													</button>
												)}
											</For>
										</div>
									</div>

									{/* Diff view */}
									<div class="commit-detail__diff">
										<Show
											when={selectedFile()}
											fallback={
												<EmptyState
													icon="file"
													detail="Select a file to view changes"
												/>
											}
										>
											<div class="commit-detail__diff__header">
												<Show when={selectedFile()!.path}>
													<span class="commit-detail__diff__header__path">
														{selectedFile()!.path}/
													</span>
												</Show>
												<span class="commit-detail__diff__header__name">
													{selectedFile()!.filename}
												</span>
											</div>
											<div class="commit-detail__diff__content">
												<CodeView
													status={
														selectedFile()!.status || 'unknown'
													}
													file={path.join(
														props.repository.path,
														selectedFile()!.path,
														selectedFile()!.filename
													)}
													repository={props.repository.path}
													fromFile={path.join(
														selectedFile()!.fromPath || '',
														selectedFile()!.from || ''
													)}
												/>
											</div>
										</Show>
									</div>
								</Show>
							</div>
						</div>
					</ModalBody>
				</>
			)}
		</Modal>
	);
};

export const showCommitDetailModal = (repository: Repository, commit: LogCommit) => {
	LocationStore.setHistoryOpen(true);
	LocationStore.setSelectedCommit(commit);

	ModalStore.pushState(
		'commitDetail',
		createRoot(() => <CommitDetailModal repository={repository} commit={commit} />)
	);
};

export default CommitDetailModal;
