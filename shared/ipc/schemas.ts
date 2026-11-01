import { z } from "zod";

const id = z.string().min(1).max(64);

/** Schemas used by the main process to validate every renderer request. */
export const schemas = {
  create: z.object({ url: z.string().max(4096).optional(), activate: z.boolean().optional() }).optional(),
  tabId: id,
  navigate: z.object({ id, input: z.string().max(4096) }),
  pin: z.object({ id, pinned: z.boolean() }),
  mute: z.object({ id, muted: z.boolean() }),
  move: z.object({ id, toIndex: z.number().int().min(0).max(10000) }),
  zoom: z.object({ id, action: z.enum(["in", "out", "reset"]) }),
  findStart: z.object({
    id,
    text: z.string().min(1).max(500),
    forward: z.boolean().optional(),
    findNext: z.boolean().optional(),
  }),
  groupUpdate: z.object({
    groupId: id,
    patch: z.object({ name: z.string().max(30).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), collapsed: z.boolean().optional() }),
  }),
  tabGroup: z.object({ id, groupId: id.nullable() }),
  overlay: z.boolean(),
  permissionRespond: z.object({ id, decision: z.enum(["once", "site", "block"]) }),
  bounds: z.object({
    x: z.number().finite().min(0).max(20000),
    y: z.number().finite().min(0).max(20000),
    width: z.number().finite().min(0).max(20000),
    height: z.number().finite().min(0).max(20000),
  }),
};
