import type { ReactNode } from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  icon: string;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'AI-Powered Task Generation',
    icon: '🤖',
    description: (
      <>
        Automatically generate detailed technical tasks from Azure DevOps user stories using Amazon Bedrock AI.
        Transform high-level requirements into actionable development tasks with acceptance criteria and testing
        requirements.
      </>
    ),
  },
  {
    title: 'Smart Knowledge Integration',
    icon: '📚',
    description: (
      <>
        Leverage team-specific knowledge bases and organizational best practices. Task Genie uses RAG
        (Retrieval-Augmented Generation) to incorporate your documentation and standards into AI-generated tasks.
      </>
    ),
  },
  {
    title: 'Seamless Azure DevOps Integration',
    icon: '🔗',
    description: (
      <>
        Deploy via Service Hooks for automatic task generation or use the browser extension for on-demand task creation.
        Works with your existing Azure DevOps workflows and project structures.
      </>
    ),
  },
];

function Feature({ title, icon, description }: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className='text--center'>
        <div className={styles.featureIcon} role='img' style={{ fontSize: '4rem', marginBottom: '1rem' }}>
          {icon}
        </div>
      </div>
      <div className='text--center padding-horiz--md'>
        <Heading as='h3'>{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className='container'>
        <div className='row'>
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
