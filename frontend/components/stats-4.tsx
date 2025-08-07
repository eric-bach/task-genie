export default function StatsSection() {
  return (
    <section className='py-16 md:py-32'>
      <div className='mx-auto max-w-5xl space-y-8 px-6 md:space-y-12'>
        <div className='relative z-10 max-w-xl space-y-6'>
          <h2 className='text-4xl font-medium lg:text-5xl'>Streamline Your Agile Workflow</h2>
          <p>
            Empower your team with AI-driven tools designed to make Agile planning faster, more efficient, and
            stress-free.
          </p>
        </div>
        <div className='grid gap-6 sm:grid-cols-2 md:gap-12 lg:gap-24'>
          <div>
            <p>
              AI-powered user story creation, seamless task breakdown, customizable workflows, time-saving automation,
              and collaboration made easy
            </p>
            <div className='mb-12 mt-12 grid grid-cols-2 gap-2 md:mb-0'>
              <div className='space-y-4'>
                <div className='bg-linear-to-r from-zinc-950 to-zinc-600 bg-clip-text text-5xl font-bold text-transparent dark:from-white dark:to-zinc-800'>
                  2800
                </div>
                <p>Tasks generated</p>
              </div>
              <div className='space-y-4'>
                <div className='bg-linear-to-r from-zinc-950 to-zinc-600 bg-clip-text text-5xl font-bold text-transparent dark:from-white dark:to-zinc-800'>
                  1200
                </div>
                <p>hours of developer time saved</p>
              </div>
            </div>
          </div>
          <div className='relative'>
            <blockquote className='border-l-4 pl-4'>
              <p>
                This app has completely transformed how we approach sprint planning. It’s like having an extra team
                member who never gets tired of organizing our work!
              </p>

              <div className='mt-6 space-y-3'>
                <cite className='block font-medium'>Sarah L, Scrum Master at TechFlow Solutions</cite>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className='h-5 w-fit dark:invert'
                  src='https://html.tailus.io/blocks/customers/nvidia.svg'
                  alt='Nvidia Logo'
                  height='20'
                  width='auto'
                />
              </div>
            </blockquote>
          </div>
        </div>
      </div>
    </section>
  );
}
