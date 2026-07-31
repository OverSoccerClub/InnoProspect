/**
 * Garante que os enums Zod deste pacote nunca divirjam dos enums Prisma
 * equivalentes em packages/db/prisma/schema.prisma. Ver nota no topo de
 * ../common.ts. Se este teste falhar, alguém mudou um lado sem mudar o
 * outro — ajuste o enum Zod (ou peça a Cronos para ajustar o schema) até os
 * dois listarem exatamente o mesmo conjunto de valores.
 */
import { describe, expect, it } from 'vitest';
import {
  LeadStatus as PrismaLeadStatus,
  PhoneType as PrismaPhoneType,
  SearchJobStatus as PrismaSearchJobStatus,
  SearchTaskStatus as PrismaSearchTaskStatus,
  LeadActivityActor as PrismaLeadActivityActor,
  UserRole as PrismaUserRole,
  LeadSourceType as PrismaLeadSourceType,
} from '@inno/db';
import {
  leadStatusSchema,
  phoneTypeSchema,
  searchJobStatusSchema,
  searchTaskStatusSchema,
  leadActivityActorSchema,
  userRoleSchema,
  leadSourceTypeSchema,
} from '../common.js';

function sortedValues(obj: Record<string, string>): string[] {
  return Object.values(obj).sort();
}

describe('paridade de enums Zod (contracts) x Prisma (db)', () => {
  it('LeadStatus', () => {
    expect([...leadStatusSchema.options].sort()).toEqual(sortedValues(PrismaLeadStatus));
  });

  it('PhoneType', () => {
    expect([...phoneTypeSchema.options].sort()).toEqual(sortedValues(PrismaPhoneType));
  });

  it('SearchJobStatus', () => {
    expect([...searchJobStatusSchema.options].sort()).toEqual(sortedValues(PrismaSearchJobStatus));
  });

  it('SearchTaskStatus', () => {
    expect([...searchTaskStatusSchema.options].sort()).toEqual(sortedValues(PrismaSearchTaskStatus));
  });

  it('LeadActivityActor', () => {
    expect([...leadActivityActorSchema.options].sort()).toEqual(sortedValues(PrismaLeadActivityActor));
  });

  it('UserRole', () => {
    expect([...userRoleSchema.options].sort()).toEqual(sortedValues(PrismaUserRole));
  });

  it('LeadSourceType', () => {
    expect([...leadSourceTypeSchema.options].sort()).toEqual(sortedValues(PrismaLeadSourceType));
  });
});
