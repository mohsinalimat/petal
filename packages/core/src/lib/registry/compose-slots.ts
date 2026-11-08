import { createElement, Fragment } from "react"
import type { ComponentType } from "react"
import type { FormSlotComponents } from "@petal/sdk"

type SlotLoader = NonNullable<FormSlotComponents["before"]>
type SlotPosition = keyof FormSlotComponents

const POSITIONS: SlotPosition[] = ["before", "after", "toolbar"]

/** Combine several lazy slot loaders into one that renders every component, in order. */
export function composeSlotLoaders(loaders: SlotLoader[]): SlotLoader {
  if (loaders.length === 1) return loaders[0]!
  return async () => {
    const mods = await Promise.all(loaders.map((load) => load()))
    const comps = mods.map((m) => m.default)
    const Composed: ComponentType<{ docname: string }> = (props) =>
      createElement(Fragment, null, ...comps.map((C, i) => createElement(C, { ...props, key: i })))
    Composed.displayName = "ComposedFormSlot"
    return { default: Composed }
  }
}

/** Merge per-app form_slots for one doctype so that every app's slot renders. */
export function mergeFormSlots(slotsPerApp: FormSlotComponents[]): FormSlotComponents {
  const merged: FormSlotComponents = {}
  for (const pos of POSITIONS) {
    const loaders = slotsPerApp.map((s) => s[pos]).filter((l): l is SlotLoader => !!l)
    if (loaders.length) merged[pos] = composeSlotLoaders(loaders)
  }
  return merged
}
