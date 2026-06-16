import { apiClient } from './client';
import {
  Department, Operator, Authority, AircraftType,
  AircraftRegistration, AuthorizationType,
} from '../types';

const BASE = '/admin/reference-data';

// ── Departments (soft delete) ──
export const listRefDepartments = (): Promise<Department[]> =>
  apiClient.get(`${BASE}/departments`).then((r) => r.data);
export const createRefDepartment = (payload: { name: string }): Promise<Department> =>
  apiClient.post(`${BASE}/departments`, payload).then((r) => r.data);
export const updateRefDepartment = (id: number, payload: { name: string }): Promise<Department> =>
  apiClient.put(`${BASE}/departments/${id}`, payload).then((r) => r.data);
export const deleteRefDepartment = (id: number): Promise<void> =>
  apiClient.delete(`${BASE}/departments/${id}`).then(() => undefined);

// ── Operators ──
export const listRefOperators = (): Promise<Operator[]> =>
  apiClient.get(`${BASE}/operators`).then((r) => r.data);
export const createRefOperator = (payload: { iataCode: string; name: string }): Promise<Operator> =>
  apiClient.post(`${BASE}/operators`, payload).then((r) => r.data);
export const updateRefOperator = (code: string, payload: { name: string }): Promise<Operator> =>
  apiClient.put(`${BASE}/operators/${encodeURIComponent(code)}`, payload).then((r) => r.data);
export const deleteRefOperator = (code: string): Promise<void> =>
  apiClient.delete(`${BASE}/operators/${encodeURIComponent(code)}`).then(() => undefined);

// ── Authorities ──
export const listRefAuthorities = (): Promise<Authority[]> =>
  apiClient.get(`${BASE}/authorities`).then((r) => r.data);
export const createRefAuthority = (payload: { code: string; fullName: string }): Promise<Authority> =>
  apiClient.post(`${BASE}/authorities`, payload).then((r) => r.data);
export const updateRefAuthority = (code: string, payload: { fullName: string }): Promise<Authority> =>
  apiClient.put(`${BASE}/authorities/${encodeURIComponent(code)}`, payload).then((r) => r.data);
export const deleteRefAuthority = (code: string): Promise<void> =>
  apiClient.delete(`${BASE}/authorities/${encodeURIComponent(code)}`).then(() => undefined);

// ── Aircraft Types (code is PK — no update) ──
export const listRefAircraftTypes = (): Promise<AircraftType[]> =>
  apiClient.get(`${BASE}/aircraft-types`).then((r) => r.data);
export const createRefAircraftType = (payload: { code: string }): Promise<AircraftType> =>
  apiClient.post(`${BASE}/aircraft-types`, payload).then((r) => r.data);
export const deleteRefAircraftType = (code: string): Promise<void> =>
  apiClient.delete(`${BASE}/aircraft-types/${encodeURIComponent(code)}`).then(() => undefined);

// ── Aircraft Registrations ──
export interface RegistrationPayload {
  registration: string;
  description?: string | null;
  serialNumber?: string | null;
  status?: string;
  aircraftTypeCode?: string | null;
  operatorCode?: string | null;
  authorityCode?: string | null;
}
export const listRefRegistrations = (operatorCode?: string): Promise<AircraftRegistration[]> =>
  apiClient.get(`${BASE}/registrations`, { params: operatorCode ? { operatorCode } : {} }).then((r) => r.data);
export const createRefRegistration = (payload: RegistrationPayload): Promise<AircraftRegistration> =>
  apiClient.post(`${BASE}/registrations`, payload).then((r) => r.data);
export const updateRefRegistration = (registration: string, payload: RegistrationPayload): Promise<AircraftRegistration> =>
  apiClient.put(`${BASE}/registrations/${encodeURIComponent(registration)}`, payload).then((r) => r.data);
export const deleteRefRegistration = (registration: string): Promise<void> =>
  apiClient.delete(`${BASE}/registrations/${encodeURIComponent(registration)}`).then(() => undefined);

// ── Authorization Types ──
export const listRefAuthorizationTypes = (): Promise<AuthorizationType[]> =>
  apiClient.get(`${BASE}/authorization-types`).then((r) => r.data);
export const createRefAuthorizationType = (payload: { code: string; description?: string | null; category?: string | null }): Promise<AuthorizationType> =>
  apiClient.post(`${BASE}/authorization-types`, payload).then((r) => r.data);
export const updateRefAuthorizationType = (id: number, payload: { description?: string | null; category?: string | null }): Promise<AuthorizationType> =>
  apiClient.put(`${BASE}/authorization-types/${id}`, payload).then((r) => r.data);
export const deleteRefAuthorizationType = (id: number): Promise<void> =>
  apiClient.delete(`${BASE}/authorization-types/${id}`).then(() => undefined);
