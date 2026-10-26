// The SharedRecord port on Autobase and Hyperbee, run by the OCN Node on disk (story 3.2).
export {
  connectSpaces,
  hasApplied,
  type ConnectOptions,
  journalHead,
  journalSince,
  openAutobaseRecord,
  type AutobaseRecordOptions,
  type AutobaseSharedRecord,
  type JournalEntry,
} from "./record.js";
