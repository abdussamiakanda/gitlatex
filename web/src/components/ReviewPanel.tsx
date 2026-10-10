/**
 * The Review sidebar view. The cards inside #review-cards are drawn by
 * editor/review.ts, which keeps each one level with its text as the editor scrolls.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, MessageSquarePlus } from 'lucide-react';
import { goToComment, onCardsClick, onCardsInput, onCardsKeydown, onCardsWheel, relayoutReview, render, setReviewShowResolved, startComment, REVIEW_SHORTCUT } from '../editor/review';
import { useStore } from '../state/store';
import { IconButton } from './ui';
import '../editor/review.css';

export function ReviewPanel() {
  const cards = useRef<HTMLDivElement>(null);
  const [resolved, setResolved] = useState(false);
  const open = useStore((s) => s.reviewCount);

  useEffect(() => {
    const el = cards.current;
    if (!el) return;
    el.addEventListener('click', onCardsClick);
    el.addEventListener('keydown', onCardsKeydown);
    el.addEventListener('input', onCardsInput);
    el.addEventListener('wheel', onCardsWheel, { passive: false });
    const ro = new ResizeObserver(() => relayoutReview());
    ro.observe(el);
    render();
    return () => {
      el.removeEventListener('click', onCardsClick);
      el.removeEventListener('keydown', onCardsKeydown);
      el.removeEventListener('input', onCardsInput);
      el.removeEventListener('wheel', onCardsWheel);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="flex h-full flex-col" aria-label="Review comments">
      <div className="flex h-9 shrink-0 items-center gap-2 pl-3 pr-1">
        <span className="mr-auto text-[11px] font-semibold uppercase tracking-wider text-muted">Review</span>
        <label className="flex items-center gap-1 text-[11.5px] text-muted" title="Show resolved threads">
          <input
            type="checkbox"
            checked={resolved}
            onChange={(e) => {
              setResolved(e.target.checked);
              setReviewShowResolved(e.target.checked);
            }}
            className="accent-[var(--c-accent)]"
          />
          Resolved
        </label>
        <IconButton size="sm" label="Previous comment" disabled={!open && !resolved} onClick={() => goToComment(-1)}>
          <ChevronUp className="size-3.5" />
        </IconButton>
        <IconButton size="sm" label="Next comment" disabled={!open && !resolved} onClick={() => goToComment(1)}>
          <ChevronDown className="size-3.5" />
        </IconButton>
        <IconButton size="sm" label="Add comment" onClick={startComment}>
          <MessageSquarePlus className="size-3.5" />
        </IconButton>
      </div>
      <div id="review-cards" ref={cards}>
        <button type="button" id="review-add" className="review-add hidden" title={`Add comment (${REVIEW_SHORTCUT})`}>
          <MessageSquarePlus className="size-3.5" />
          Add comment
        </button>
        <div id="review-empty" className="review-empty hidden" />
      </div>
      <div id="review-identity" className="review-identity" />
    </div>
  );
}
