"use client"

import { useState, type ReactNode } from "react"
import { cn } from "../lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single navigation item. Mirrors `SidebarItem` from `@petal/sdk` so that
 * the core app can pass its items directly without an adapter.
 */
export interface SidebarNavItem {
  label: string
  path: string
  /**
   * Icon — three forms:
   * 1. Registry name string (resolved via `resolveIcon` prop)
   * 2. Raw `<svg…>` string (rendered via dangerouslySetInnerHTML)
   * 3. Render function `() => ReactNode`
   */
  icon?: string | (() => ReactNode)
  badge?: () => ReactNode
  children?: SidebarNavItem[]
  hidden?: boolean
}

export interface SidebarNavProps {
  items: SidebarNavItem[]
  /** Items pinned to the bottom of the sidebar, above the footer. */
  bottomItems?: SidebarNavItem[]
  /** Whether the sidebar is visible. */
  isOpen: boolean
  /** The current page href, used to highlight the active item. */
  activeHref: string
  /**
   * Render a navigation link. Inject your framework's `<Link>` here.
   *
   * @example
   * renderLink={(href, children) => <Link href={href}>{children}</Link>}
   */
  renderLink: (href: string, children: ReactNode) => ReactNode
  /**
   * Resolve a named icon string to a render function.
   * Wire up your app's icon registry here.
   *
   * @example
   * resolveIcon={(name) => iconRegistry.resolve(name)}
   */
  resolveIcon?: (name: string) => (() => ReactNode) | null
  /** Brand name shown in the sidebar header. Default: "Petal" */
  brandName?: string
  /** Brand version shown below the name. Default: "Enterprise" */
  brandVersion?: string
  /** Called when the user taps the backdrop or a nav item on mobile — use to close the drawer. */
  onClose?: () => void
  className?: string
}

// ---------------------------------------------------------------------------
// Icon renderer
// ---------------------------------------------------------------------------

interface SidebarIconProps {
  icon: SidebarNavItem["icon"]
  resolveIcon?: (name: string) => (() => ReactNode) | null
}

function SidebarIcon({ icon, resolveIcon }: SidebarIconProps) {
  if (!icon) return null

  if (typeof icon === "function") {
    return <span className="flex h-5 w-5 items-center justify-center">{icon()}</span>
  }

  if (icon.trimStart().startsWith("<svg")) {
    return (
      <span
        className="flex h-5 w-5 items-center justify-center"
        dangerouslySetInnerHTML={{ __html: icon }}
      />
    )
  }

  const renderer = resolveIcon?.(icon)
  if (renderer) {
    return <span className="flex h-5 w-5 items-center justify-center">{renderer()}</span>
  }

  // Fallback: treat as emoji / text
  return <span className="flex h-5 w-5 items-center justify-center text-base">{icon}</span>
}

// ---------------------------------------------------------------------------
// SidebarLink — recursive item renderer
// ---------------------------------------------------------------------------

interface SidebarLinkProps {
  item: SidebarNavItem
  activeHref: string
  renderLink: (href: string, children: ReactNode) => ReactNode
  resolveIcon?: (name: string) => (() => ReactNode) | null
  onClose?: () => void
  depth?: number
}

function SidebarLink({ item, activeHref, renderLink, resolveIcon, onClose, depth = 0 }: SidebarLinkProps) {
  const isActive  = activeHref === item.path
  const [isOpen, setIsOpen] = useState(isActive)
  const hasChildren = (item.children?.length ?? 0) > 0

  if (item.hidden) return null

  return (
    <li>
      <div
        className={cn(
          "flex items-center gap-3 rounded-md px-4 py-2.5 text-sm font-medium transition-colors",
          isActive
            ? "border-l-4 border-primary bg-primary/10 text-primary"
            : "text-foreground/70 hover:bg-accent hover:text-foreground",
        )}
        onClick={!hasChildren && onClose ? () => { if (window.innerWidth < 768) onClose() } : undefined}
      >
        {renderLink(
          item.path,
          <span className="flex flex-1 min-w-0 items-center gap-3">
            <SidebarIcon icon={item.icon} {...(resolveIcon !== undefined && { resolveIcon })} />
            <span className="flex-1 truncate">{item.label}</span>
            {item.badge && <span>{item.badge()}</span>}
          </span>,
        )}

        {hasChildren && (
          <button
            onClick={() => setIsOpen((v) => !v)}
            className="shrink-0 rounded p-0.5 hover:bg-accent/60"
            aria-label={isOpen ? "Collapse" : "Expand"}
            aria-expanded={isOpen}
          >
            <svg
              className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
      </div>

      {hasChildren && isOpen && (
        <ul className="mt-1 space-y-1 border-l border-border/50 ml-4 pl-3">
          {item.children!.map((child) => (
            <SidebarLink
              key={child.path}
              item={child}
              activeHref={activeHref}
              renderLink={renderLink}
              {...(onClose !== undefined && { onClose })}
              {...(resolveIcon !== undefined && { resolveIcon })}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// SidebarNav
// ---------------------------------------------------------------------------

/**
 * Collapsible navigation sidebar. Fully decoupled from Next.js and Petal's
 * store — inject `renderLink` and `resolveIcon` from your app layer.
 *
 * @example
 * <SidebarNav
 *   items={sidebarItems}
 *   isOpen={sidebarOpen}
 *   activeHref={pathname}
 *   renderLink={(href, children) => <Link href={href}>{children}</Link>}
 *   resolveIcon={(name) => iconRegistry.resolve(name)}
 * />
 */
export function SidebarNav({
  items,
  bottomItems,
  isOpen,
  activeHref,
  renderLink,
  resolveIcon,
  brandName    = "Petal",
  brandVersion = "Enterprise",
  onClose,
  className,
}: SidebarNavProps) {
  return (
    <>
      {/* Backdrop — mobile only, shown while drawer is open */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "flex flex-col overflow-hidden border-r bg-background",
          // Mobile: fixed slide-in drawer
          "fixed inset-y-0 left-0 z-50 w-72 h-full",
          "transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "-translate-x-full",
          // Desktop: static sidebar in flow; hidden when closed
          "md:relative md:inset-auto md:z-auto md:h-screen md:w-64 md:shrink-0",
          !isOpen && "md:hidden",
          className,
        )}
      >
        {/* Brand header */}
        <div className="flex h-16 items-center border-b bg-gradient-to-r from-primary/5 to-transparent px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-lg font-bold text-white">
              {brandName[0]?.toUpperCase() ?? "P"}
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">{brandName}</p>
              <p className="text-xs text-muted-foreground">{brandVersion}</p>
            </div>
          </div>
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto p-4">
          <ul className="space-y-1">
            {items.map((item) => (
              <SidebarLink
                key={item.path}
                item={item}
                activeHref={activeHref}
                renderLink={renderLink}
                {...(onClose !== undefined && { onClose })}
                {...(resolveIcon !== undefined && { resolveIcon })}
              />
            ))}
          </ul>
        </nav>

        {/* Pinned bottom items */}
        {bottomItems && bottomItems.length > 0 && (
          <nav className="border-t p-4">
            <ul className="space-y-1">
              {bottomItems.map((item) => (
                <SidebarLink
                  key={item.path}
                  item={item}
                  activeHref={activeHref}
                  renderLink={renderLink}
                  {...(onClose !== undefined && { onClose })}
                  {...(resolveIcon !== undefined && { resolveIcon })}
                />
              ))}
            </ul>
          </nav>
        )}

        {/* Footer */}
        <div className="border-t p-4">
          <div className="px-2 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground">{brandName}</p>
            <p>v1.0.0</p>
          </div>
        </div>
      </aside>
    </>
  )
}
