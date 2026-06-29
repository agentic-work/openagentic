/**
 * dataRequestRecord.ts — re-export shim.
 *
 * Canonical source: services/shared/workflow-engine/src/dataRequestRecord.ts
 * Sister of approvalRecord.ts. Edit the shared file, never this shim.
 */
export {
  createDataRequestRecord,
  type DataRequestRecordPayload,
  type DataRequestField,
  type DataRequestRow,
} from '@openagentic/workflow-engine/dataRequestRecord';
