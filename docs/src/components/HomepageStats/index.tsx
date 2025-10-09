import type { ReactNode } from 'react';
import Heading from '@theme/Heading';

const stats = [
  {
    number: '75%',
    label: 'Less Planning Time',
    description: 'Reduce manual task creation effort',
  },
  {
    number: '3x',
    label: 'Faster Breakdown',
    description: 'Convert user stories to tasks quickly',
  },
  {
    number: '100%',
    label: 'Azure DevOps Integration',
    description: 'Works with your existing workflow',
  },
];

export default function HomepageStats(): ReactNode {
  return (
    <section className='padding-vert--xl'>
      <div className='container'>
        <div className='text--center margin-bottom--xl'>
          <Heading as='h2'>Why Teams Choose Task Genie</Heading>
          <p className='hero__subtitle'>Proven results from development teams using AI-powered task generation</p>
        </div>
        <div className='row'>
          {stats.map(({ number, label, description }, idx) => (
            <div key={idx} className='col col--4 text--center'>
              <div className='padding-horiz--md'>
                <Heading
                  as='h3'
                  className='margin-bottom--sm'
                  style={{ fontSize: '3rem', color: 'var(--ifm-color-primary)' }}
                >
                  {number}
                </Heading>
                <Heading as='h4' className='margin-bottom--sm'>
                  {label}
                </Heading>
                <p>{description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
