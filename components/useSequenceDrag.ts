import React from 'react';

type UseSequenceDragArgs = {
  draggingSequenceItemId: string | null;
  isPublicLibrary: boolean;
  onReorderSequenceItem: (sourceItemId: string, targetItemId: string) => void;
  setDraggingSequenceItemId: React.Dispatch<React.SetStateAction<string | null>>;
  setDropTargetSequenceItemId: React.Dispatch<React.SetStateAction<string | null>>;
};

export function useSequenceDrag({
  draggingSequenceItemId,
  isPublicLibrary,
  onReorderSequenceItem,
  setDraggingSequenceItemId,
  setDropTargetSequenceItemId,
}: UseSequenceDragArgs) {
  const handleSequenceDragStart = (event: React.DragEvent<HTMLElement>, itemId: string) => {
    if (isPublicLibrary) {
      return;
    }
    setDraggingSequenceItemId(itemId);
    setDropTargetSequenceItemId(itemId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', itemId);
  };

  const handleSequenceDragOver = (event: React.DragEvent<HTMLElement>, itemId: string) => {
    if (isPublicLibrary) {
      return;
    }
    event.preventDefault();
    if (!draggingSequenceItemId) {
      return;
    }
    event.dataTransfer.dropEffect = 'move';
    setDropTargetSequenceItemId(itemId);
  };

  const handleSequenceDrop = (event: React.DragEvent<HTMLElement>, itemId: string) => {
    if (isPublicLibrary) {
      return;
    }
    event.preventDefault();
    const sourceItemId = event.dataTransfer.getData('text/plain') || draggingSequenceItemId;
    if (sourceItemId && sourceItemId !== itemId) {
      onReorderSequenceItem(sourceItemId, itemId);
    }
    setDraggingSequenceItemId(null);
    setDropTargetSequenceItemId(null);
  };

  const handleSequenceDragEnd = () => {
    setDraggingSequenceItemId(null);
    setDropTargetSequenceItemId(null);
  };

  return {
    handleSequenceDragEnd,
    handleSequenceDragOver,
    handleSequenceDragStart,
    handleSequenceDrop,
  };
}
