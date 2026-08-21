import App from '../App';
import CapstoneLauncher from './CapstoneLauncher';
import CapstoneReportSyncAgent from './CapstoneReportSyncAgent';
import CheckpointLauncher from './CheckpointLauncher';
import CurriculumSyncAgent from './CurriculumSyncAgent';
import DeferredFeaturePortals from './DeferredFeaturePortals';
import EvidenceSyncAgent from './EvidenceSyncAgent';
import LearningAnalyticsAgent from './LearningAnalyticsAgent';
import LearningAnalyticsLauncher from './LearningAnalyticsLauncher';
import OnboardingAgent from './OnboardingAgent';
import OnboardingLauncher from './OnboardingLauncher';

export default function AuthenticatedAcademy() {
  return <>
    <App />
    <CheckpointLauncher />
    <OnboardingLauncher />
    <CapstoneLauncher />
    <LearningAnalyticsLauncher />
    <DeferredFeaturePortals />
    <CurriculumSyncAgent />
    <EvidenceSyncAgent />
    <CapstoneReportSyncAgent />
    <OnboardingAgent />
    <LearningAnalyticsAgent />
  </>;
}
