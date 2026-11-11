'use client';

import { BaseEdge, EdgeLabelRenderer, getBezierPath, useReactFlow, useStore, type EdgeProps } from '@xyflow/react';
import { X } from 'lucide-react';
import { memo } from 'react';

function LinkEdgeView({ id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected }: EdgeProps) {
  const { deleteElements } = useReactFlow();
  const touchesSelection = useStore(
    (s) => !!(s.nodeLookup.get(source)?.selected || s.nodeLookup.get(target)?.selected),
  );
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const active = selected || touchesSelection;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={24}
        className="edge-line"
        style={active ? { stroke: '#818cf8', strokeWidth: 2 } : undefined}
      />
      {selected && !touchesSelection ? (
        <EdgeLabelRenderer>
          <button
            type="button"
            aria-label="선 지우기"
            className="nodrag nopan absolute flex h-6 w-6 items-center justify-center rounded-full border border-line-strong bg-surface text-ink-2 hover:border-bad hover:text-bad"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: 'all' }}
            onClick={() => void deleteElements({ edges: [{ id }] })}
          >
            <X size={13} />
          </button>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const LinkEdge = memo(LinkEdgeView);
