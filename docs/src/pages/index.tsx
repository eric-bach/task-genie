import type { ReactNode } from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import HomepageFeatures from '@site/src/components/HomepageFeatures';
import HomepageCallout from '@site/src/components/HomepageCallout';
import HomepageStats from '@site/src/components/HomepageStats';
import Heading from '@theme/Heading';

import styles from './index.module.css';

function HomepageHeader() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className='container'>
        <Heading as='h1' className='hero__title'>
          {siteConfig.title}
        </Heading>
        <p className='hero__subtitle'>{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link className='button button--secondary button--lg' to='/docs/intro'>
            Get Started 🚀
          </Link>
          <Link
            className='button button--outline button--primary button--lg'
            to='/docs/api'
            style={{ marginLeft: '1rem' }}
          >
            View API Docs 📖
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title} - AI-Powered Task Generation`}
      description='Transform Azure DevOps user stories into detailed technical tasks using AI. Streamline your agile development workflow with intelligent task generation powered by Amazon Bedrock.'
    >
      <HomepageHeader />
      <main>
        <HomepageFeatures />
        <HomepageStats />
        <HomepageCallout />
      </main>
    </Layout>
  );
}
