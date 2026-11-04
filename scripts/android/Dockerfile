# Self-contained Android toolchain, so the build host needs nothing but Docker.
FROM eclipse-temurin:21-jdk

ENV ANDROID_HOME=/opt/android-sdk
ENV PATH=/opt/node/bin:/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools:$PATH

# The build network corrupts parallel apt downloads ("Hash Sum mismatch"), so fetch one at a time.
RUN APT="-o Acquire::http::Pipeline-Depth=0 -o Acquire::Queue-Mode=access -o Acquire::Retries=5" \
  && apt-get $APT update \
  && apt-get $APT install -y --no-install-recommends curl unzip xz-utils \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /opt/node \
  && curl -fsSL https://nodejs.org/dist/v22.23.4/node-v22.23.4-linux-x64.tar.xz \
  | tar -xJ --strip-components=1 -C /opt/node

RUN mkdir -p /opt/android-sdk/cmdline-tools \
  && curl -fsSL -o /tmp/tools.zip https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip \
  && unzip -q /tmp/tools.zip -d /opt/android-sdk/cmdline-tools \
  && mv /opt/android-sdk/cmdline-tools/cmdline-tools /opt/android-sdk/cmdline-tools/latest \
  && rm /tmp/tools.zip \
  && (yes | sdkmanager --licenses > /dev/null) \
  && sdkmanager --install "platform-tools" "platforms;android-36" "build-tools;35.0.0" "build-tools;36.0.0" > /dev/null
