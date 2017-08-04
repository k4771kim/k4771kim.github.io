---
layout: post
title:  "Android Kotlin 프로그래밍 - Hello World!"
---
<br />

그럼 Kotlin을 지원하는 안드로이드스튜디오 3.0(Beta)을 사용하여 모바일에 Hello World를 출력하는 앱을 생성해 보겠다.

안드로이드 스튜디오의 메뉴에서 New Project를 선택, 체크박스 Include Kotlin support를 체크하고 새로운 Project를 생성했다.

자바를 지원하는 기존의 프로젝트 생성과 다르게 프로젝트 플더의 java폴더 안에(?) MainActivity.kt가 생성된 것을 볼 수 있었다.

코틀린을 본격적으로 공부하기 전에 자바 코드와 코틀린 코드를 간단히 비교해보면 도움이 될 것 같다.

기본으로 생성 된 파일 중 MainActivity 파일을 비교해 보도록 하겠다.
<br />
**Java**
```java
package foroom.kbg.javaapp;

import android.support.v7.app.AppCompatActivity;
import android.os.Bundle;

public class MainActivity extends AppCompatActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
    }
}
```

**Kotlin**
```kotlin
package foroom.kbg.myfirstkotlinapp

import android.support.v7.app.AppCompatActivity
import android.os.Bundle

class MainActivity : AppCompatActivity() { 

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
    }
}
```

문법적인 부분의 차이는 대략적으로 비교해 볼 수 있었다. 

클래스, 메소드 정의 방법이 다르고 코틀린은 세미콜론이 필요 없다는 것 정도?

모바일에 Build - Run 하는 부분은 다를 것이 없었다.

내일은 본격적으로 어플리케이션을 만들어 보기 전에 코틀린의 기초적인 문법에 대해 공부하기로 하겠다.