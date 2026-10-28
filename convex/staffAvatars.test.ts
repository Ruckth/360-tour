// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { internalMutation } from './_generated/server';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { STAFF_AVATAR_UPLOAD_TTL_MS } from './crons';
import { MAX_AVATAR_BYTES } from './lib/imageUploads';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function setup() {
	vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
	const t = convexTest(schema, modules);
	const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
	const stranger = t.withIdentity({ email: 'guest@example.com', tokenIdentifier: 'guest' });
	const person = { role: 'Therapist', color: '#abc', workingHours: [{ weekday: 1, start: '09:00', end: '18:00' }], breaks: [] };
	const staffId = await admin.mutation(api.adminServices.createStaff, { name: 'Mali', ...person });
	/** A file in storage, as if the browser had just POSTed it to an upload URL. */
	const storeFile = (contentType = 'image/webp', size = 90 * 1024) =>
		t.run(async (ctx) => {
			const storageId = await ctx.storage.store(new Blob(['image-bytes']));
			// convex-test doesn't record these; patch them to stand in for a real upload.
			await ctx.db.patch(storageId as never, { contentType, size } as never);
			return storageId;
		});
	/** Uploaded and checked, but not yet saved on anyone. */
	const pendingUpload = () => admin.action(api.adminServices.uploadStaffAvatar, { bytes: new ArrayBuffer(90 * 1024), contentType: 'image/webp' });
	const staff = async (id: Id<'staff'> = staffId) => (await t.run((ctx) => ctx.db.get(id)))!;
	const fileExists = async (storageId: Id<'_storage'>) => (await t.run((ctx) => ctx.db.system.get(storageId))) !== null;
	const pendingIds = async () => (await t.run((ctx) => ctx.db.query('staffAvatarUploads').collect())).map((row) => row.storageId);
	return { t, admin, stranger, person, staffId, storeFile, pendingUpload, staff, fileExists, pendingIds };
}

describe('staff photo uploads', () => {
	it('requires an admin to upload, discard or attach a photo', async () => {
		const { t, stranger, staffId, storeFile, pendingUpload, fileExists, pendingIds } = await setup();
		const raw = await storeFile();
		const photo = { bytes: new ArrayBuffer(1000), contentType: 'image/webp' };
		await expect(t.action(api.adminServices.uploadStaffAvatar, photo)).rejects.toThrow('Not authenticated');
		await expect(stranger.action(api.adminServices.uploadStaffAvatar, photo)).rejects.toThrow('Not authorized');
		const storageId = await pendingUpload();
		await expect(t.mutation(api.adminServices.discardStaffAvatarUpload, { storageId })).rejects.toThrow('Not authenticated');
		await expect(stranger.mutation(api.adminServices.discardStaffAvatarUpload, { storageId })).rejects.toThrow('Not authorized');
		await expect(stranger.mutation(api.adminServices.updateStaff, { staffId, avatarStorageId: storageId })).rejects.toThrow('Not authorized');
		await expect(stranger.mutation(api.adminServices.updateStaff, { staffId, avatarStorageId: null })).rejects.toThrow('Not authorized');
		expect(await fileExists(raw)).toBe(true);
		expect(await fileExists(storageId)).toBe(true);
		expect(await pendingIds()).toEqual([storageId]);
	});

	it('rejects the wrong type or size before storing anything', async () => {
		const { t, admin, pendingIds } = await setup();
		await expect(admin.action(api.adminServices.uploadStaffAvatar, { bytes: new ArrayBuffer(1000), contentType: 'image/png' })).rejects.toThrow('Photos must be optimized WebP or JPEG');
		await expect(admin.action(api.adminServices.uploadStaffAvatar, { bytes: new ArrayBuffer(MAX_AVATAR_BYTES + 1), contentType: 'image/webp' })).rejects.toThrow('Photos must be 400 KB or smaller');
		expect(await t.run((ctx) => ctx.db.system.query('_storage').collect())).toEqual([]);
		const jpeg = await admin.action(api.adminServices.uploadStaffAvatar, { bytes: new ArrayBuffer(MAX_AVATAR_BYTES), contentType: 'image/jpeg' });
		expect(await pendingIds()).toEqual([jpeg]);
	});


	it('rejects conflicting upload and URL inputs on create without consuming the upload', async () => {
		const { admin, person, pendingUpload, pendingIds } = await setup();
		const storageId = await pendingUpload();
		await expect(admin.mutation(api.adminServices.createStaff, {
			name: 'Nok', ...person, avatarStorageId: storageId, avatarUrl: 'https://example.com/photo.jpg',
		})).rejects.toThrow('either');
		expect(await pendingIds()).toEqual([storageId]);
	});

	it('attaches an upload on create and on update', async () => {
		const { admin, person, staffId, pendingUpload, staff, pendingIds } = await setup();
		const first = await pendingUpload();
		const createdId = await admin.mutation(api.adminServices.createStaff, { name: 'Nok', ...person, avatarStorageId: first });
		expect(await staff(createdId)).toMatchObject({ avatarStorageId: first, avatarUrl: expect.stringMatching(/^https:\/\//) });
		const second = await pendingUpload();
		await admin.mutation(api.adminServices.updateStaff, { staffId, avatarStorageId: second });
		expect(await staff()).toMatchObject({ avatarStorageId: second, avatarUrl: expect.stringMatching(/^https:\/\//) });
		expect(await pendingIds()).toEqual([]);
	});

	it('replaces a photo, deleting the old file only once the save succeeds', async () => {
		const { admin, staffId, pendingUpload, staff, fileExists } = await setup();
		const old = await pendingUpload();
		await admin.mutation(api.adminServices.updateStaff, { staffId, avatarStorageId: old });
		const before = await staff();

		const next = await pendingUpload();
		// The save fails on the hours, so nothing about the photo may change.
		await expect(admin.mutation(api.adminServices.updateStaff, { staffId, avatarStorageId: next, workingHours: [{ weekday: 7, start: '09:00', end: '17:00' }] })).rejects.toThrow('Weekday');
		expect(await staff()).toMatchObject({ avatarStorageId: old, avatarUrl: before.avatarUrl });
		expect(await fileExists(old)).toBe(true);
		await expect(admin.mutation(api.adminServices.updateStaff, { staffId, avatarStorageId: null, name: ' ' })).rejects.toThrow();
		expect(await fileExists(old)).toBe(true);

		await admin.mutation(api.adminServices.updateStaff, { staffId, avatarStorageId: next });
		expect((await staff()).avatarStorageId).toBe(next);
		expect(await fileExists(old)).toBe(false);
		expect(await fileExists(next)).toBe(true);
		// Saving the same photo again (a retry) changes nothing.
		await admin.mutation(api.adminServices.updateStaff, { staffId, avatarStorageId: next });
		expect(await fileExists(next)).toBe(true);
	});

	it('removes a photo back to initials and deletes its file', async () => {
		const { admin, staffId, pendingUpload, staff, fileExists } = await setup();
		const storageId = await pendingUpload();
		await admin.mutation(api.adminServices.updateStaff, { staffId, avatarStorageId: storageId });
		await admin.mutation(api.adminServices.updateStaff, { staffId, avatarStorageId: null });
		expect((await staff()).avatarUrl).toBeUndefined();
		expect((await staff()).avatarStorageId).toBeUndefined();
		expect(await fileExists(storageId)).toBe(false);
		await admin.mutation(api.adminServices.updateStaff, { staffId, avatarStorageId: null }); // already gone: harmless
	});

	it('keeps a managed photo referenced by another staff member through a legacy URL', async () => {
		const { admin, person, staffId, pendingUpload, staff, fileExists } = await setup();
		const storageId = await pendingUpload();
		await admin.mutation(api.adminServices.updateStaff, { staffId, avatarStorageId: storageId });
		const avatarUrl = (await staff()).avatarUrl;
		const otherId = await admin.mutation(api.adminServices.createStaff, { name: 'Nok', ...person, avatarUrl });
		await admin.mutation(api.adminServices.updateStaff, { staffId, avatarStorageId: null });
		expect(await fileExists(storageId)).toBe(true);
		expect((await staff(otherId)).avatarUrl).toBe(avatarUrl);
	});

	it('keeps a legacy URL photo through other edits, and lets an upload or removal replace it', async () => {
		const { admin, staffId, pendingUpload, staff, fileExists } = await setup();
		const url = 'https://example.com/mali.jpg';
		await admin.mutation(api.adminServices.updateStaff, { staffId, avatarUrl: url });
		await admin.mutation(api.adminServices.updateStaff, { staffId, name: 'Mali K', workingHours: [{ weekday: 2, start: '10:00', end: '16:00' }] });
		expect(await staff()).toMatchObject({ name: 'Mali K', avatarUrl: url });
		expect((await staff()).avatarStorageId).toBeUndefined();

		const storageId = await pendingUpload();
		await admin.mutation(api.adminServices.updateStaff, { staffId, avatarStorageId: storageId });
		expect((await staff()).avatarUrl).not.toBe(url);
		// Re-sending the saved URL keeps the upload; a different URL replaces it and frees the file.
		await admin.mutation(api.adminServices.updateStaff, { staffId, avatarUrl: (await staff()).avatarUrl });
		expect((await staff()).avatarStorageId).toBe(storageId);
		await admin.mutation(api.adminServices.updateStaff, { staffId, avatarUrl: url });
		expect(await staff()).toMatchObject({ avatarUrl: url });
		expect((await staff()).avatarStorageId).toBeUndefined();
		expect(await fileExists(storageId)).toBe(false);

		await admin.mutation(api.adminServices.updateStaff, { staffId, avatarStorageId: null });
		expect((await staff()).avatarUrl).toBeUndefined();
		await expect(admin.mutation(api.adminServices.updateStaff, { staffId, avatarUrl: url, avatarStorageId: null })).rejects.toThrow('either');
	});

	it('only attaches or deletes files this feature manages', async () => {
		const { admin, person, staffId, storeFile, pendingUpload, staff, fileExists } = await setup();
		// A file that never went through the avatar check, e.g. a villa photo.
		const villaPhoto = await storeFile('image/webp', 5000);
		await expect(admin.mutation(api.adminServices.updateStaff, { staffId, avatarStorageId: villaPhoto })).rejects.toThrow('Photo upload not found');
		await expect(admin.mutation(api.adminServices.createStaff, { name: 'Nok', ...person, avatarStorageId: villaPhoto })).rejects.toThrow('Photo upload not found');
		await admin.mutation(api.adminServices.discardStaffAvatarUpload, { storageId: villaPhoto });
		expect(await fileExists(villaPhoto)).toBe(true);

		// Another staff member's active photo can't be taken over, re-registered or discarded.
		const malis = await pendingUpload();
		await admin.mutation(api.adminServices.updateStaff, { staffId, avatarStorageId: malis });
		const nokId = await admin.mutation(api.adminServices.createStaff, { name: 'Nok', ...person });
		await expect(admin.mutation(api.adminServices.updateStaff, { staffId: nokId, avatarStorageId: malis })).rejects.toThrow('Photo upload not found');
		await admin.mutation(api.adminServices.discardStaffAvatarUpload, { storageId: malis });
		await admin.mutation(api.adminServices.updateStaff, { staffId: nokId, avatarStorageId: null });
		expect(await fileExists(malis)).toBe(true);
		expect((await staff()).avatarStorageId).toBe(malis);
	});

	it('cannot register existing property files through the public upload API', async () => {
		const { t, admin, storeFile, fileExists, pendingIds } = await setup();
		const png = await storeFile('image/png');
		const webp = await storeFile('image/webp', 5000);
		// A caller cannot hand an existing ID to the upload action: it accepts only new bytes.
		await expect(admin.action(api.adminServices.uploadStaffAvatar, { storageId: png } as never)).rejects.toThrow();
		await expect(admin.action(api.adminServices.uploadStaffAvatar, { storageId: webp } as never)).rejects.toThrow();
		await admin.mutation(api.adminServices.discardStaffAvatarUpload, { storageId: png });
		await admin.mutation(api.adminServices.discardStaffAvatarUpload, { storageId: webp });
		await t.mutation(internal.crons.cleanStaffAvatarUploads, {});
		expect(await fileExists(png)).toBe(true);
		expect(await fileExists(webp)).toBe(true);
		expect(await pendingIds()).toEqual([]);
	});

	it('cleans up a newly stored file when pending registration fails', async () => {
		vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
		const failingModules = {
			...modules,
			'./adminServices.ts': async () => {
				const actual = await import('./adminServices');
				return { ...actual, registerStaffAvatarUpload: internalMutation({ args: { storageId: v.id('_storage') }, handler: () => { throw new Error('Registration failed'); } }) };
			},
		};
		const t = convexTest(schema, failingModules);
		const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
		await expect(admin.action(api.adminServices.uploadStaffAvatar, { bytes: new ArrayBuffer(1000), contentType: 'image/webp' })).rejects.toThrow('Registration failed');
		expect(await t.run((ctx) => ctx.db.system.query('_storage').collect())).toEqual([]);
	});

	it('cleans up uploads from failed or cancelled saves, never attached photos', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'));
		const { t, admin, staffId, pendingUpload, staff, fileExists, pendingIds } = await setup();
		const discarded = await pendingUpload();
		await admin.mutation(api.adminServices.discardStaffAvatarUpload, { storageId: discarded });
		expect(await fileExists(discarded)).toBe(false);

		const abandoned = await pendingUpload();
		const attached = await pendingUpload();
		await admin.mutation(api.adminServices.updateStaff, { staffId, avatarStorageId: attached });
		vi.setSystemTime(Date.now() + STAFF_AVATAR_UPLOAD_TTL_MS - 60_000);
		const fresh = await pendingUpload();
		await t.mutation(internal.crons.cleanStaffAvatarUploads, {});
		expect(await fileExists(abandoned)).toBe(true); // not stale yet

		vi.setSystemTime(Date.now() + 120_000);
		await t.mutation(internal.crons.cleanStaffAvatarUploads, {});
		expect(await fileExists(abandoned)).toBe(false);
		expect(await fileExists(attached)).toBe(true);
		expect(await fileExists(fresh)).toBe(true);
		expect(await pendingIds()).toEqual([fresh]);
		expect((await staff()).avatarStorageId).toBe(attached);
	});
});

describe('service photos', () => {
	const fields = (staffId: Id<'staff'>) => ({ slug: 'thai-massage', name: 'Thai Massage', description: '', category: 'Wellness', durationMin: 60, bufferMin: 15, price: 1200, currency: 'THB', staffIds: [staffId] });

	it('attaches an upload on create and replaces or removes it on update, deleting the old file', async () => {
		const { t, admin, staffId, pendingUpload, fileExists, pendingIds } = await setup();
		const first = await pendingUpload();
		const serviceId = await admin.mutation(api.adminServices.createService, { ...fields(staffId), imageStorageId: first });
		const service = async () => (await t.run((ctx) => ctx.db.get(serviceId)))!;
		expect((await service()).imageStorageId).toBe(first);
		expect((await service()).imageUrl).toBeTruthy();
		expect(await pendingIds()).toEqual([]);

		const second = await pendingUpload();
		await admin.mutation(api.adminServices.updateService, { serviceId, imageStorageId: second });
		expect((await service()).imageStorageId).toBe(second);
		expect(await fileExists(first)).toBe(false);

		// Saving other fields keeps the photo.
		await admin.mutation(api.adminServices.updateService, { serviceId, name: 'Thai Massage (60)' });
		expect((await service()).imageStorageId).toBe(second);

		await admin.mutation(api.adminServices.updateService, { serviceId, imageStorageId: null });
		expect((await service()).imageUrl).toBeUndefined();
		expect((await service()).imageStorageId).toBeUndefined();
		expect(await fileExists(second)).toBe(false);
	});


	it('preserves a service photo reused as a staff avatar through a legacy URL', async () => {
		const { t, admin, staffId, pendingUpload, fileExists, staff } = await setup();
		const storageId = await pendingUpload();
		const serviceId = await admin.mutation(api.adminServices.createService, { ...fields(staffId), imageStorageId: storageId });
		const service = await t.run((ctx) => ctx.db.get(serviceId));
		await admin.mutation(api.adminServices.updateStaff, { staffId, avatarUrl: service!.imageUrl });
		await admin.mutation(api.adminServices.updateService, { serviceId, imageStorageId: null });
		expect(await fileExists(storageId)).toBe(true);
		expect((await staff()).avatarUrl).toBe(service!.imageUrl);
	});

	it('rolls back a consumed upload when a service save fails and allows a retry', async () => {
		const { t, admin, staffId, pendingUpload, fileExists, pendingIds } = await setup();
		const old = await pendingUpload();
		const serviceId = await admin.mutation(api.adminServices.createService, { ...fields(staffId), imageStorageId: old });
		const next = await pendingUpload();
		await expect(admin.mutation(api.adminServices.updateService, { serviceId, imageStorageId: next, name: ' ' })).rejects.toThrow();
		expect((await t.run((ctx) => ctx.db.get(serviceId)))!.imageStorageId).toBe(old);
		expect(await fileExists(old)).toBe(true);
		expect(await pendingIds()).toEqual([next]);
		await admin.mutation(api.adminServices.updateService, { serviceId, imageStorageId: next });
		await admin.mutation(api.adminServices.updateService, { serviceId, imageStorageId: next });
		expect(await pendingIds()).toEqual([]);
		expect(await fileExists(next)).toBe(true);
		expect(await fileExists(old)).toBe(false);
	});

	it('refuses files that were not uploaded as photos, and non-admins', async () => {
		const { admin, stranger, staffId, storeFile, pendingUpload, fileExists } = await setup();
		const raw = await storeFile();
		await expect(admin.mutation(api.adminServices.createService, { ...fields(staffId), imageStorageId: raw })).rejects.toThrow('Photo upload not found');
		expect(await fileExists(raw)).toBe(true);
		const serviceId = await admin.mutation(api.adminServices.createService, fields(staffId));
		await expect(stranger.mutation(api.adminServices.updateService, { serviceId, imageStorageId: await pendingUpload() })).rejects.toThrow('Not authorized');
	});
});
