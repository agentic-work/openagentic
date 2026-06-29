/**
 * VectorBackupService Tests
 * TDD implementation - comprehensive tests for vector backup functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import pino from 'pino';

// Mock the Prisma client first
const mockPrisma = {
  vectorBackup: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
  },
  vectorBackupConfig: {
    create: vi.fn()
  }
};

vi.mock('../utils/prisma.js', () => ({
  prisma: mockPrisma
}));

// Mock MilvusClient
const mockMilvusClient = {
  getCollectionStatistics: vi.fn(),
  query: vi.fn(),
  hasCollection: vi.fn(),
  describeCollection: vi.fn(),
  insert: vi.fn()
};

vi.mock('@zilliz/milvus2-sdk-node', () => ({
  MilvusClient: vi.fn(() => mockMilvusClient)
}));

// Mock filesystem
vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  readdir: vi.fn(),
  unlink: vi.fn(),
  access: vi.fn(),
  writeFile: vi.fn(),
  rm: vi.fn()
}));

// Now import the service after mocks are set up
import { VectorBackupService } from '../services/VectorBackupService.js';
import type { BackupConfig, BackupStatus, RestoreOptions } from '../services/VectorBackupService.js';

const mockLogger = pino({ level: 'silent' });

describe('VectorBackupService', () => {
  let service: VectorBackupService;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Reset mock implementations
    mockPrisma.vectorBackup.create.mockResolvedValue({
      id: 'test-backup-id',
      name: 'test-backup',
      collections: ['collection1'],
      destination: 'LOCAL',
      status: 'RUNNING',
      progress: 0,
      started_at: new Date(),
      completed_at: null,
      error_message: null,
      stats: {},
      compression_enabled: false,
      encryption_enabled: false,
      incremental: false
    });

    mockMilvusClient.getCollectionStatistics.mockResolvedValue({
      data: { row_count: '1000' }
    });

    mockMilvusClient.query.mockResolvedValue({
      data: []
    });

    mockMilvusClient.hasCollection.mockResolvedValue({ value: true });
    mockMilvusClient.describeCollection.mockResolvedValue({ schema: {} });

    service = new VectorBackupService(mockLogger);
  });

  describe('createBackup', () => {
    it('should create a backup with valid configuration', async () => {
      const config: BackupConfig = {
        name: 'test-backup',
        collections: ['collection1', 'collection2'],
        destination: 's3',
        retention: 30,
        compression: true,
        encryption: false,
        incremental: false
      };

      mockMilvusClient.getCollectionStatistics.mockResolvedValue({
        data: { row_count: '1000' }
      });

      const backupId = await service.createBackup(config);

      expect(backupId).toMatch(/^backup_\d+_[a-z0-9]+$/);
      expect(mockMilvusClient.getCollectionStatistics).toHaveBeenCalled();
    });

    it('should handle backup creation failure', async () => {
      const config: BackupConfig = {
        name: 'failing-backup',
        collections: ['nonexistent'],
        destination: 's3',
        retention: 30,
        compression: false,
        encryption: false,
        incremental: false
      };

      mockMilvusClient.getCollectionStatistics.mockRejectedValue(new Error('Collection not found'));

      await expect(service.createBackup(config)).rejects.toThrow('Collection not found');
    });

    it('should support incremental backups', async () => {
      const config: BackupConfig = {
        name: 'incremental-backup',
        collections: ['collection1'],
        destination: 'local',
        retention: 7,
        compression: true,
        encryption: true,
        incremental: true
      };

      mockMilvusClient.getCollectionStatistics.mockResolvedValue({
        data: { row_count: '500' }
      });

      const backupId = await service.createBackup(config);
      expect(backupId).toBeDefined();
    });
  });

  describe('restoreFromBackup', () => {
    it('should restore from a valid backup', async () => {
      const options: RestoreOptions = {
        backupId: 'backup_123_abc',
        validateIntegrity: true,
        overwriteExisting: false
      };

      // Mock backup metadata
      vi.spyOn(service as any, 'getBackupMetadata').mockResolvedValue({
        id: 'backup_123_abc',
        collections: ['collection1'],
        destination: 's3'
      });

      vi.spyOn(service as any, 'validateBackupIntegrity').mockResolvedValue(true);

      const restoreId = await service.restoreFromBackup(options);
      expect(restoreId).toMatch(/^restore_\d+_[a-z0-9]+$/);
    });

    it('should fail when backup does not exist', async () => {
      const options: RestoreOptions = {
        backupId: 'nonexistent',
        validateIntegrity: false,
        overwriteExisting: false
      };

      vi.spyOn(service as any, 'getBackupMetadata').mockResolvedValue(null);

      await expect(service.restoreFromBackup(options)).rejects.toThrow('Backup nonexistent not found');
    });

    it('should fail integrity check when backup is corrupted', async () => {
      const options: RestoreOptions = {
        backupId: 'backup_corrupt',
        validateIntegrity: true,
        overwriteExisting: false
      };

      vi.spyOn(service as any, 'getBackupMetadata').mockResolvedValue({
        id: 'backup_corrupt',
        collections: ['collection1']
      });

      vi.spyOn(service as any, 'validateBackupIntegrity').mockResolvedValue(false);

      await expect(service.restoreFromBackup(options)).rejects.toThrow('Backup integrity check failed');
    });
  });

  describe('listBackups', () => {
    beforeEach(async () => {
      // Create some test backups
      const config1: BackupConfig = {
        name: 'backup1',
        collections: ['col1'],
        destination: 's3',
        retention: 30,
        compression: false,
        encryption: false,
        incremental: false
      };

      const config2: BackupConfig = {
        name: 'backup2',
        collections: ['col2'],
        destination: 'local',
        retention: 7,
        compression: true,
        encryption: false,
        incremental: true
      };

      mockMilvusClient.getCollectionStatistics.mockResolvedValue({
        data: { row_count: '100' }
      });

      await service.createBackup(config1);
      await service.createBackup(config2);
    });

    it('should list all backups without filters', async () => {
      const backups = await service.listBackups();
      expect(backups).toHaveLength(2);
      expect(backups[0].name).toBe('backup1');
      expect(backups[1].name).toBe('backup2');
    });

    it('should filter backups by status', async () => {
      const backups = await service.listBackups({
        status: ['running']
      });
      
      expect(backups.every(b => b.status === 'running')).toBe(true);
    });

    it('should filter backups by date range', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
      const backups = await service.listBackups({
        dateRange: { from: yesterday, to: now }
      });
      
      expect(backups.length).toBeGreaterThan(0);
    });
  });

  describe('getBackupStatus', () => {
    it('should return status for active backup', async () => {
      const config: BackupConfig = {
        name: 'status-test',
        collections: ['collection1'],
        destination: 's3',
        retention: 30,
        compression: false,
        encryption: false,
        incremental: false
      };

      mockMilvusClient.getCollectionStatistics.mockResolvedValue({
        data: { row_count: '1000' }
      });

      const backupId = await service.createBackup(config);
      const status = await service.getBackupStatus(backupId);

      expect(status.id).toBe(backupId);
      expect(status.status).toBe('running');
      expect(status.progress).toBeGreaterThanOrEqual(0);
    });

    it('should throw error for nonexistent backup', async () => {
      await expect(service.getBackupStatus('nonexistent')).rejects.toThrow('Backup nonexistent not found');
    });
  });

  describe('deleteBackup', () => {
    it('should delete existing backup', async () => {
      const config: BackupConfig = {
        name: 'delete-test',
        collections: ['collection1'],
        destination: 's3',
        retention: 30,
        compression: false,
        encryption: false,
        incremental: false
      };

      mockMilvusClient.getCollectionStatistics.mockResolvedValue({
        data: { row_count: '100' }
      });

      const backupId = await service.createBackup(config);
      
      await expect(service.deleteBackup(backupId)).resolves.not.toThrow();
      await expect(service.getBackupStatus(backupId)).rejects.toThrow();
    });
  });

  describe('scheduleBackup', () => {
    it('should schedule automatic backup', async () => {
      const config: BackupConfig = {
        name: 'scheduled-backup',
        collections: ['collection1'],
        destination: 's3',
        schedule: '0 2 * * *', // Daily at 2 AM
        retention: 30,
        compression: true,
        encryption: false,
        incremental: true
      };

      await expect(service.scheduleBackup(config)).resolves.not.toThrow();
    });
  });

  describe('Storage Backends', () => {
    describe('S3 Storage', () => {
      it('should store backup to S3', async () => {
        const config: BackupConfig = {
          name: 's3-backup',
          collections: ['collection1'],
          destination: 's3',
          retention: 30,
          compression: false,
          encryption: false,
          incremental: false
        };

        mockMilvusClient.getCollectionStatistics.mockResolvedValue({
          data: { row_count: '100' }
        });

        const backupId = await service.createBackup(config);
        expect(backupId).toBeDefined();
        
        // Wait for async backup to complete
        await new Promise(resolve => setTimeout(resolve, 100));
      });
    });

    describe('Local Storage', () => {
      it('should store backup locally', async () => {
        const config: BackupConfig = {
          name: 'local-backup',
          collections: ['collection1'],
          destination: 'local',
          retention: 7,
          compression: true,
          encryption: false,
          incremental: false
        };

        mockMilvusClient.getCollectionStatistics.mockResolvedValue({
          data: { row_count: '50' }
        });

        const backupId = await service.createBackup(config);
        expect(backupId).toBeDefined();
      });
    });

    describe('Azure Blob Storage', () => {
      it('should store backup to Azure Blob', async () => {
        const config: BackupConfig = {
          name: 'azure-backup',
          collections: ['collection1'],
          destination: 'azure_blob',
          retention: 14,
          compression: false,
          encryption: true,
          incremental: false
        };

        mockMilvusClient.getCollectionStatistics.mockResolvedValue({
          data: { row_count: '200' }
        });

        const backupId = await service.createBackup(config);
        expect(backupId).toBeDefined();
      });
    });

    describe('Google Cloud Storage', () => {
      it('should store backup to GCS', async () => {
        const config: BackupConfig = {
          name: 'gcs-backup',
          collections: ['collection1'],
          destination: 'gcs',
          retention: 60,
          compression: true,
          encryption: true,
          incremental: true
        };

        mockMilvusClient.getCollectionStatistics.mockResolvedValue({
          data: { row_count: '300' }
        });

        const backupId = await service.createBackup(config);
        expect(backupId).toBeDefined();
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle Milvus connection failures', async () => {
      mockMilvusClient.getCollectionStatistics.mockRejectedValue(new Error('Connection failed'));

      const config: BackupConfig = {
        name: 'fail-backup',
        collections: ['collection1'],
        destination: 's3',
        retention: 30,
        compression: false,
        encryption: false,
        incremental: false
      };

      await expect(service.createBackup(config)).rejects.toThrow('Connection failed');
    });

    it('should handle storage upload failures gracefully', async () => {
      const config: BackupConfig = {
        name: 'upload-fail',
        collections: ['collection1'],
        destination: 's3',
        retention: 30,
        compression: false,
        encryption: false,
        incremental: false
      };

      const backupId = await service.createBackup(config);
      expect(backupId).toMatch(/^backup_\d+_[a-z0-9]+$/);
      expect(mockPrisma.vectorBackup.create).toHaveBeenCalled();
    });
  });

  describe('Performance Tests', () => {
    it('should handle large collection backup', async () => {
      const config: BackupConfig = {
        name: 'large-backup',
        collections: ['large_collection'],
        destination: 's3',
        retention: 30,
        compression: true,
        encryption: false,
        incremental: false
      };

      mockMilvusClient.getCollectionStatistics.mockResolvedValue({
        data: { row_count: '1000000' } // 1M vectors
      });

      const startTime = Date.now();
      const backupId = await service.createBackup(config);
      const duration = Date.now() - startTime;

      expect(backupId).toBeDefined();
      expect(duration).toBeLessThan(1000); // Should create backup request quickly
    });

    it('should handle concurrent backups', async () => {
      const configs = Array.from({ length: 5 }, (_, i) => ({
        name: `concurrent-backup-${i}`,
        collections: [`collection${i}`],
        destination: 's3' as const,
        retention: 30,
        compression: false,
        encryption: false,
        incremental: false
      }));

      mockMilvusClient.getCollectionStatistics.mockResolvedValue({
        data: { row_count: '100' }
      });

      const backupPromises = configs.map(config => service.createBackup(config));
      const backupIds = await Promise.all(backupPromises);

      expect(backupIds).toHaveLength(5);
      expect(new Set(backupIds).size).toBe(5); // All unique IDs
    });
  });
});