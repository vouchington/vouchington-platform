export {
  startAwsEmulator,
  trustAwsEmulatorCertificate,
  type AwsEmulatorConnection,
  type RunningAwsEmulator,
  type StartAwsEmulatorOptions,
} from './emulator.mts'
export {
  AWS_EMULATOR_IDLE_TIMEOUT_SECONDS,
  readAnnouncedPort,
  startAwsEmulatorInDocker,
  type StartAwsEmulatorInDockerOptions,
  type StartedAwsEmulatorProcess,
} from './emulator-docker.mts'
export {
  debArch,
  ensureAwsEmulatorBinary,
  type AwsEmulatorPackagePin,
  type DebArch,
  type EnsureAwsEmulatorBinaryOptions,
} from './emulator-package.mts'
export { provisionFirehoseStreams, type ProvisionFirehoseStreamsOptions } from './firehose.mts'
export {
  createTestS3Bucket,
  deleteS3Object,
  listS3Keys,
  listS3Versions,
  putS3Object,
  readS3ObjectBytes,
  readS3ObjectText,
  s3ObjectExists,
  sendToPresignedS3Url,
  uniqueS3Prefix,
  type S3VersionEntry,
} from './s3.mts'
export { countTestSqsMessages, createTestSqsQueue, sendTestSqsMessage } from './sqs.mts'
