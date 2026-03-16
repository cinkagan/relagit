import { Show, createSignal } from 'solid-js';

import { createStoreListener } from '@stores/index';
import LocationStore from '@stores/location';
import RepositoryStore from '@stores/repository';

import Header from '@ui/Workspace/Header';
import BranchPanel from './BranchPanel';
import CommitGraph from './CommitGraph';

import './index.scss';

export default () => {
	const repository = createStoreListener(
		[LocationStore, RepositoryStore],
		() => RepositoryStore.getById(LocationStore.selectedRepository?.id)
	);

	const [relatedBranches, setRelatedBranches] = createSignal<string[]>([]);
	const [selectedPanelBranch, setSelectedPanelBranch] = createSignal<string | null>(null);

	return (
		<div class="workspace">
			<Header />
			<div class="workspace__content">
				<Show when={repository()}>
					<div class="workspace__content__branches">
						<BranchPanel
							branches={relatedBranches()}
							selectedBranch={selectedPanelBranch()}
							onSelectBranch={setSelectedPanelBranch}
						/>
					</div>
					<div class="workspace__content__graph">
						<CommitGraph
							onBranchesFound={setRelatedBranches}
							highlightBranch={selectedPanelBranch()}
						/>
					</div>
				</Show>
			</div>
		</div>
	);
};
