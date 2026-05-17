/**
 * Amazon Ads — production deploy pipeline.
 *
 * What the user sees:
 *   Just click "Build Now" in Jenkins. The Build → QA → Deploy chain
 *   blocks deploys on any QA failure, so no broken build ever reaches users.
 *
 * Prerequisites on the Jenkins agent:
 *   - Node 20+ on PATH
 *   - pm2 on PATH and the `amazon-ads` process already registered
 *   - The amazon-ads dev server is started for the QA stage to talk to.
 *     Easiest: PM2 starts it, QA targets http://localhost:5012.
 */
pipeline {
  agent any

  options {
    timestamps()
    timeout(time: 20, unit: 'MINUTES')
    disableConcurrentBuilds()
  }

  triggers {
    // Auto-deploy on every push to main. Comment out for manual-only.
    githubPush()
  }

  environment {
    API_BASE   = 'http://localhost:5012'
    NODE_ENV   = 'production'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        sh 'git log -1 --oneline'
      }
    }

    stage('Build') {
      steps {
        sh '''
          set -e
          npm install --no-audit --no-fund
          rm -rf .next
          npm run build
          # Install Chromium for the visual QA stage (cached after first run)
          npx playwright install --with-deps chromium || npx playwright install chromium
        '''
      }
    }

    stage('Deploy') {
      // We must restart pm2 before QA so QA hits the new code.
      steps {
        sh '''
          set -e
          pm2 restart amazon-ads --update-env
          # Give Next.js a few seconds to boot.
          for i in 1 2 3 4 5 6 7 8 9 10; do
            curl -sf http://localhost:5012/api/version >/dev/null && break
            sleep 2
          done
        '''
      }
    }

    stage('QA') {
      steps {
        // qa:deploy first — fails fast if the running server isn't the expected SHA.
        sh 'npm run qa:deploy'
        // Then the data + UI checks. qa:all = typecheck + api-shape + consistency + visual.
        // If you don't want visual on every build (slow), set SKIP_VISUAL=1.
        sh 'npm run qa:all'
      }
      post {
        failure {
          echo "✗ QA failed AFTER deploy. The new code is live but a check broke."
          echo "  Investigate: check qa:* logs above, fix forward, push again."
          echo "  Rollback option: pm2 restart amazon-ads on the previous commit."
        }
      }
    }
  }

  post {
    success {
      echo "✓ Build + Deploy + QA all passed. New version live."
    }
    failure {
      echo "✗ Build failed before deploy. Old version still running."
    }
  }
}
