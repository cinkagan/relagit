import Modal, { ModalBody, ModalCloseButton, ModalFooter, ModalHeader, showErrorModal } from '..';
import { Show, createRoot } from 'solid-js';

import { t } from '@app/modules/i18n';
import { refetchRepository } from '~/app/src/modules/actions';
import * as Git from '~/app/src/modules/git';
import {
	abortSequentialMerge,
	continueSequentialMerge,
	isSequentialMergeActive,
	mergeQueue
} from '~/app/src/modules/git/sequential-merge';
import ModalStore from '~/app/src/stores/modal';
import { Repository } from '~/app/src/stores/repository';

import Button from '../../Common/Button';

import './index.scss';

export const ConflictModal = (props: { repository: Repository }) => {
	return (
		<Modal size="medium" dismissable id={'conflict'}>
			{(p) => {
				const queue = mergeQueue();
				const isSequential = isSequentialMergeActive();

				return (
					<>
						<ModalHeader title={t('modal.conflict.title')}>
							<ModalCloseButton close={p.close} />
						</ModalHeader>
						<ModalBody>
							<p class="conflict-modal__message">
								{t('modal.conflict.message')}
							</p>
							<p class="conflict-modal__hint">
								{t('modal.conflict.hint')}
							</p>
							<Show when={isSequential && queue}>
								<div class="conflict-modal__sequential-info">
									<p class="conflict-modal__sequential-info__progress">
										{t('modal.conflict.sequentialProgress', {
											current: String((queue!.currentIndex || 0) + 1),
											total: String(queue!.branches.length)
										})}
										{': '}
										<strong>{queue!.branches[queue!.currentIndex]}</strong>
									</p>
									<Show when={(queue!.completedBranches || []).length > 0}>
										<p class="conflict-modal__sequential-info__completed">
											{t('modal.conflict.sequentialCompleted', {
												count: String(queue!.completedBranches.length)
											})}
										</p>
									</Show>
								</div>
							</Show>
						</ModalBody>
						<ModalFooter>
							<div class="modal__footer__buttons">
								<Button
									type="default"
									label={t('modal.close')}
									onClick={p.close}
								>
									{t('modal.close')}
								</Button>
								<Show when={isSequential}>
									<Button
										type="brand"
										label={t('modal.conflict.continue')}
										dedupe
										onClick={async () => {
											try {
												p.close();
												await continueSequentialMerge();
											} catch (e) {
												showErrorModal(e, 'error.git');
											}
										}}
									>
										{t('modal.conflict.continue')}
									</Button>
								</Show>
								<Button
									type="danger"
									label={t('modal.conflict.abort')}
									dedupe
									onClick={async () => {
										try {
											await Git.MergeAbort(props.repository);

											if (isSequential) {
												abortSequentialMerge();
											}

											await refetchRepository(props.repository);

											p.close();
										} catch (e) {
											showErrorModal(e, 'error.git');
										}
									}}
								>
									{t('modal.conflict.abort')}
								</Button>
							</div>
						</ModalFooter>
					</>
				);
			}}
		</Modal>
	);
};

export const showConflictModal = (repository: Repository | undefined) => {
	if (!repository) return;

	ModalStore.pushState(
		'conflict',
		createRoot(() => <ConflictModal repository={repository} />)
	);
};
