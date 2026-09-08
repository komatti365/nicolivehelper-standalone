/*
 Copyright (c) 2017-2018 amano <amano@miku39.jp>

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
 */

var Talker = {
    _speed: 1.0,
    _volume: 1.0,

    speech: function( text, n ){
        try{
            let synthes = new SpeechSynthesisUtterance( text );
            synthes.voice = this._webvoices[n];
            synthes.rate = this._speed;
            synthes.volume = this._volume;
            speechSynthesis.speak( synthes );
        }catch( e ){
            console.log( e );
        }
    },

    /**
     * しゃべる
     * @param text テキスト
     * @param n ボイスの選択(0,1,...)
     * @param vol 音量
     * @param spd 速度
     */
    speech2: function( text, n, vol, spd ){
        try{
            let synthes = new SpeechSynthesisUtterance( text );
            synthes.voice = this._webvoices[n];
            synthes.rate = spd;
            synthes.volume = vol;
            speechSynthesis.speak( synthes );
        }catch( e ){
            console.log( e );
        }
    },

    setVolume: function( v ){
        this._volume = v;
    },
    setSpeed: function( s ){
        this._speed = s;
    },

    init: function(){
        this._webvoices = speechSynthesis.getVoices();
    }
};
