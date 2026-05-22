import * as React from 'react'
import './styles.css'

export interface PaginatorState {
  page: number
  pageSize: number
}

interface PaginatorProps extends PaginatorState {
  total: number
  onChange: (next: PaginatorState) => void
  pageSizes?: number[]
}

const DEFAULT_SIZES = [100, 500, 1000]

export const Paginator: React.FC<PaginatorProps> = ({
  page,
  pageSize,
  total,
  onChange,
  pageSizes = DEFAULT_SIZES,
}) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const isFirst = page <= 1
  const isLast = page >= totalPages

  // Hide entirely when there's nothing to paginate.
  if (total <= pageSize) return null

  function go(nextPage: number, nextSize: number = pageSize) {
    onChange({ page: Math.max(1, Math.min(totalPages, nextPage)), pageSize: nextSize })
  }

  return (
    <div className="aw-paginator" role="navigation" aria-label="Pagination">
      <div className="aw-paginator__sizes">
        {pageSizes.map((s) => (
          <button
            key={s}
            type="button"
            className="aw-paginator__size"
            data-page-size={s}
            data-active={s === pageSize ? 'true' : undefined}
            onClick={() => onChange({ page: 1, pageSize: s })}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="aw-paginator__nav">
        <button
          type="button"
          className="aw-paginator__arrow"
          data-nav="first"
          disabled={isFirst}
          onClick={() => go(1)}
          aria-label="First page"
        >
          ⏮
        </button>
        <button
          type="button"
          className="aw-paginator__arrow"
          data-nav="prev"
          disabled={isFirst}
          onClick={() => go(page - 1)}
          aria-label="Previous page"
        >
          ◀
        </button>
        <span className="aw-paginator__loc">
          page {page} of {totalPages}
        </span>
        <button
          type="button"
          className="aw-paginator__arrow"
          data-nav="next"
          disabled={isLast}
          onClick={() => go(page + 1)}
          aria-label="Next page"
        >
          ▶
        </button>
        <button
          type="button"
          className="aw-paginator__arrow"
          data-nav="last"
          disabled={isLast}
          onClick={() => go(totalPages)}
          aria-label="Last page"
        >
          ⏭
        </button>
      </div>
    </div>
  )
}
