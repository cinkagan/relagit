import { createSignal } from 'solid-js';

import { refetchRepository } from '~/app/src/modules/actions';
import { Repository } from '~/app/src/stores/repository';

import { showConflictModal } from '../../ui/Modal/Conflict';
import { Merge } from './merge';

export interface MergeQueueState {
	repository: Repository;
	branches: string[];
	currentIndex: number;
	status: 'idle' | 'merging' | 'conflict' | 'done' | 'aborted';
	completedBranches: string[];
	failedBranch: string | null;
}

const [mergeQueue, setMergeQueue] = createSignal<MergeQueueState | null>(null);

export { mergeQueue };

export const startSequentialMerge = async (repository: Repository, branches: string[]) => {
	if (branches.length === 0) return;

	setMergeQueue({
		repository,
		branches,
		currentIndex: 0,
		status: 'merging',
		completedBranches: [],
		failedBranch: null
	});

	await processNextMerge();
};

export const processNextMerge = async () => {
	const queue = mergeQueue();
	if (!queue || queue.status === 'done' || queue.status === 'aborted') return;

	const { repository, branches, currentIndex } = queue;

	if (currentIndex >= branches.length) {
		setMergeQueue((prev) => (prev ? { ...prev, status: 'done' } : null));
		await refetchRepository(repository);
		return;
	}

	const branch = branches[currentIndex];

	setMergeQueue((prev) => (prev ? { ...prev, status: 'merging' } : null));

	try {
		await Merge(repository, branch);

		setMergeQueue((prev) =>
			prev
				? {
						...prev,
						currentIndex: prev.currentIndex + 1,
						completedBranches: [...prev.completedBranches, branch]
					}
				: null
		);

		await refetchRepository(repository);

		// Process next branch
		await processNextMerge();
	} catch (e) {
		const msg = typeof e === 'string' ? e : (e as Error)?.message || '';
		const isConflict =
			msg.toLowerCase().includes('conflict') ||
			msg.toLowerCase().includes('resolve your current index') ||
			(e instanceof Error && e.message.toLowerCase().lastIndexOf('error:') === -1);

		if (isConflict) {
			setMergeQueue((prev) =>
				prev
					? {
							...prev,
							status: 'conflict',
							failedBranch: branch
						}
					: null
			);

			// Show conflict modal with sequential merge context
			showConflictModal(repository);
		} else {
			setMergeQueue((prev) =>
				prev
					? {
							...prev,
							status: 'aborted',
							failedBranch: branch
						}
					: null
			);
			throw e;
		}
	}
};

export const continueSequentialMerge = async () => {
	const queue = mergeQueue();
	if (!queue || queue.status !== 'conflict') return;

	// User resolved conflicts and committed - move to next branch
	setMergeQueue((prev) =>
		prev
			? {
					...prev,
					currentIndex: prev.currentIndex + 1,
					completedBranches: [...prev.completedBranches, prev.branches[prev.currentIndex]],
					status: 'merging',
					failedBranch: null
				}
			: null
	);

	await refetchRepository(queue.repository);
	await processNextMerge();
};

export const abortSequentialMerge = () => {
	setMergeQueue(null);
};

export const isSequentialMergeActive = () => {
	const queue = mergeQueue();
	return queue !== null && queue.status !== 'done' && queue.status !== 'idle';
};
