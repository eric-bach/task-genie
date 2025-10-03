import type { ReactNode } from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import Link from '@docusaurus/Link';

export default function HomepageCallout(): ReactNode {
  return (
    <section className='hero hero--dark'>
      <div className='container'>
        <div className='row'>
          <div className='col col--8 col--offset-2'>
            <div className='text--center'>
              <Heading as='h2'>Ready to Transform Your Development Workflow?</Heading>
              <p className='hero__subtitle'>
                Join teams already using Task Genie to automatically generate detailed, actionable tasks from user
                stories. Reduce planning time and improve development consistency with AI-powered task generation.
              </p>
              <div className='margin-top--lg'>
                <Link
                  className='button button--primary button--lg margin-right--md'
                  to='/docs/getting-started/installation'
                >
                  Install Task Genie
                </Link>
                <Link className='button button--outline button--lg' to='/docs/intro'>
                  Learn More
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
