import React, { createContext, useContext } from 'react';

interface DragDropContextType {
  isGlobalDragOver: boolean;
  setGlobalDragOver: (v: boolean) => void;
}

export const DragDropContext = createContext<DragDropContextType>({
  isGlobalDragOver: false,
  setGlobalDragOver: () => {},
});

export const useDragDrop = () => useContext(DragDropContext);